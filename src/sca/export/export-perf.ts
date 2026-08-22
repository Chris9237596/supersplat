type ExportPerfTimings = {
    cacheLookupMs: number;
    sogBuildMs: number;
    sogCacheHit: boolean;
    sogBuildCount: number;
    regionMasksMs: number;
    htmlBundleMs: number;
    zipMs: number;
    totalMs: number;
    compressionBackend: 'cpu' | 'webgpu' | 'unknown';
};

const isExportPerfEnabled = (): boolean => {
    const debug = (window as { SCA3D?: { debug?: { export?: boolean } } }).SCA3D?.debug;
    if (debug?.export === true) {
        return true;
    }
    try {
        return localStorage.getItem('sca.export.perf') === '1';
    } catch {
        return false;
    }
};

class ExportPerfTracker {
    private startedAt = performance.now();
    private stageStartedAt = performance.now();
    private timings: Partial<ExportPerfTimings> = {
        sogCacheHit: false,
        sogBuildCount: 0,
        compressionBackend: 'unknown'
    };

    markStageStart(): void {
        this.stageStartedAt = performance.now();
    }

    elapsedMs(): number {
        return Math.round(performance.now() - this.stageStartedAt);
    }

    endStage<K extends keyof ExportPerfTimings>(key: K, value: ExportPerfTimings[K]): void {
        this.timings[key] = value;
        this.markStageStart();
    }

    setPartial(values: Partial<ExportPerfTimings>): void {
        Object.assign(this.timings, values);
    }

    finish(): ExportPerfTimings {
        const totalMs = Math.round(performance.now() - this.startedAt);
        return {
            cacheLookupMs: this.timings.cacheLookupMs ?? 0,
            sogBuildMs: this.timings.sogBuildMs ?? 0,
            sogCacheHit: this.timings.sogCacheHit ?? false,
            sogBuildCount: this.timings.sogBuildCount ?? 0,
            regionMasksMs: this.timings.regionMasksMs ?? 0,
            htmlBundleMs: this.timings.htmlBundleMs ?? 0,
            zipMs: this.timings.zipMs ?? 0,
            totalMs,
            compressionBackend: this.timings.compressionBackend ?? 'unknown'
        };
    }

    log(timings: ExportPerfTimings): void {
        if (!isExportPerfEnabled()) {
            return;
        }

        console.log(
            '[SCA EXPORT PERF] ' +
            `cacheLookupMs=${timings.cacheLookupMs} ` +
            `sogBuildMs=${timings.sogBuildMs} ` +
            `sogCacheHit=${timings.sogCacheHit} ` +
            `sogBuildCount=${timings.sogBuildCount} ` +
            `regionMasksMs=${timings.regionMasksMs} ` +
            `htmlBundleMs=${timings.htmlBundleMs} ` +
            `zipMs=${timings.zipMs} ` +
            `totalMs=${timings.totalMs} ` +
            `compressionBackend=${timings.compressionBackend}`
        );
    }
}

export {
    ExportPerfTimings,
    ExportPerfTracker,
    isExportPerfEnabled
};
