import { Container } from '@playcanvas/pcui';

import { Events } from '../../events';
import { Splat } from '../../splat';
import { i18n } from '../../ui/localization';
import {
    buildRuntimeViewerPreviewHtml,
    ScaRuntimeAssetLoadError,
    ScaRuntimePackageOptions,
    WebGPUUnavailableError
} from '../export/export-sca-runtime-package';
import { HotspotStore } from '../store/hotspot-store';

type RuntimePreviewStatus = {
    renderer: string;
    pickerMode: string;
    gaussianIndex: string;
    regionId: string;
    hoverRegionId: string;
    ready: boolean;
};

const readIframeRuntimeStatus = (iframe: HTMLIFrameElement): RuntimePreviewStatus => {
    const fallback: RuntimePreviewStatus = {
        renderer: '…',
        pickerMode: '…',
        gaussianIndex: '…',
        regionId: '…',
        hoverRegionId: '…',
        ready: false
    };

    try {
        const win = iframe.contentWindow as Window & {
            SCA3D?: {
                pickerMode?: string;
                state?: {
                    lastPickGaussianIndex?: number | null;
                    selectedRegionId?: string | null;
                    hoverRegionId?: string | null;
                    regionRuntimeReady?: boolean;
                };
            };
            global?: { app?: { graphicsDevice?: { isWebGPU?: boolean } } };
        };

        if (!win?.SCA3D) {
            return fallback;
        }

        const gd = win.global?.app?.graphicsDevice;
        const state = win.SCA3D.state ?? {};

        return {
            renderer: gd?.isWebGPU ? 'WebGPU' : gd ? 'WebGL2' : '…',
            pickerMode: win.SCA3D.pickerMode ?? 'production',
            gaussianIndex: state.lastPickGaussianIndex !== null && state.lastPickGaussianIndex !== undefined ?
                String(state.lastPickGaussianIndex) :
                'null',
            regionId: state.selectedRegionId ?? 'null',
            hoverRegionId: state.hoverRegionId ?? 'null',
            ready: !!state.regionRuntimeReady
        };
    } catch {
        return fallback;
    }
};

const registerScaRuntimeViewerPreviewUi = (events: Events, canvasContainer: Container): void => {
    let overlay: HTMLDivElement | null = null;
    let iframe: HTMLIFrameElement | null = null;
    let objectUrl: string | null = null;
    let statusTimer: ReturnType<typeof setInterval> | null = null;
    let building = false;

    const statusRenderer = { dom: document.createElement('div') };
    const statusPicker = { dom: document.createElement('span') };
    const statusGaussian = { dom: document.createElement('span') };
    const statusRegion = { dom: document.createElement('span') };
    const statusHover = { dom: document.createElement('span') };

    const updateStatusBar = () => {
        if (!iframe) {
            return;
        }
        const status = readIframeRuntimeStatus(iframe);
        statusRenderer.dom.textContent = `Renderer: ${status.renderer}`;
        statusPicker.dom.textContent = `Picker: ${status.pickerMode}`;
        statusGaussian.dom.textContent = `Gaussian: ${status.gaussianIndex}`;
        statusRegion.dom.textContent = `Region: ${status.regionId}`;
        statusHover.dom.textContent = `Hover: ${status.hoverRegionId}`;
    };

    const stopStatusPolling = () => {
        if (statusTimer !== null) {
            clearInterval(statusTimer);
            statusTimer = null;
        }
    };

    const revokePreviewUrl = () => {
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
    };

    const closePreview = () => {
        stopStatusPolling();
        revokePreviewUrl();
        iframe = null;
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
        events.fire('sca.runtimeViewerPreview.closed');
    };

    const openPreviewSurface = (html: string, pickerMode: string) => {
        closePreview();

        overlay = document.createElement('div');
        overlay.id = 'sca-runtime-viewer-preview-overlay';
        overlay.className = 'sca-runtime-viewer-preview-overlay';

        const header = document.createElement('div');
        header.className = 'sca-runtime-viewer-preview-header';

        const title = document.createElement('div');
        title.className = 'sca-runtime-viewer-preview-title';
        title.textContent = 'Runtime Viewer Preview';

        const subtitle = document.createElement('div');
        subtitle.className = 'sca-runtime-viewer-preview-subtitle';
        subtitle.textContent = 'Unified GSplat · exported viewer bundle · runtime region masks';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'sca-runtime-viewer-preview-close';
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', closePreview);

        header.append(title, subtitle, closeButton);

        iframe = document.createElement('iframe');
        iframe.className = 'sca-runtime-viewer-preview-frame';
        iframe.title = 'SCA Runtime Viewer Preview';

        const statusBar = document.createElement('div');
        statusBar.className = 'sca-runtime-viewer-preview-status';

        statusRenderer.dom.className = 'sca-runtime-viewer-preview-status-item';
        statusPicker.dom.className = 'sca-runtime-viewer-preview-status-item';
        statusPicker.dom.textContent = `Picker: ${pickerMode}`;
        statusGaussian.dom.className = 'sca-runtime-viewer-preview-status-item';
        statusRegion.dom.className = 'sca-runtime-viewer-preview-status-item';
        statusHover.dom.className = 'sca-runtime-viewer-preview-status-item';

        statusBar.append(
            statusRenderer.dom,
            statusPicker.dom,
            statusGaussian.dom,
            statusRegion.dom,
            statusHover.dom
        );

        overlay.append(header, iframe, statusBar);
        canvasContainer.dom.appendChild(overlay);

        objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        iframe.src = objectUrl;

        iframe.addEventListener('load', () => {
            updateStatusBar();
            stopStatusPolling();
            statusTimer = setInterval(updateStatusBar, 250);
        });

        events.fire('sca.runtimeViewerPreview.opened', { pickerMode });
        console.log('[SCA RUNTIME PREVIEW] opened (iframe blob URL — use iframe DevTools for [SCA PICK]/[SCA REGION] logs)');
    };

    events.on('sca.runtimeViewerPreview.open', async (options: ScaRuntimePackageOptions = {}) => {
        if (building) {
            return;
        }

        const splats = events.invoke('scene.splats') as Splat[] | undefined;
        if (!Array.isArray(splats) || splats.length === 0) {
            await events.invoke('showPopup', {
                type: 'error',
                header: 'Runtime Preview Failed',
                message: 'Load a Gaussian splat before opening the runtime viewer preview.'
            });
            return;
        }

        const store = events.invoke('sca.store') as HotspotStore;

        building = true;
        try {
            const result = await buildRuntimeViewerPreviewHtml(
                splats,
                store.getProject(),
                events,
                options
            );
            openPreviewSurface(result.html, result.pickerMode);
        } catch (error) {
            if (error instanceof WebGPUUnavailableError) {
                await events.invoke('showPopup', {
                    type: 'error',
                    header: i18n.t('popup.error'),
                    message: i18n.t('popup.webgpu-unavailable')
                });
                return;
            }

            if (error instanceof ScaRuntimeAssetLoadError) {
                console.error('[SCA RUNTIME PREVIEW] runtime asset load failed:', {
                    assetPath: error.assetPath,
                    cause: error.cause
                });
                await events.invoke('showPopup', {
                    type: 'error',
                    header: 'SCA Runtime export failed',
                    message: error.message
                });
                return;
            }

            console.error('[SCA RUNTIME PREVIEW] build failed:', error);
            await events.invoke('showPopup', {
                type: 'error',
                header: 'Runtime Preview Failed',
                message: error instanceof Error ? error.message : 'Unknown build error'
            });
        } finally {
            building = false;
        }
    });

    events.on('scene.clear', closePreview);
};

export { registerScaRuntimeViewerPreviewUi };
