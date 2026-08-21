import {
    AppBase,
    Asset,
    EnvLighting,
    TEXTUREPROJECTION_EQUIRECT,
    Texture
} from 'playcanvas';

const EQUIRECT_TEXTURE_DATA = {
    type: 'rgbp',
    projection: TEXTUREPROJECTION_EQUIRECT,
    mipmaps: false,
    addressu: 'repeat',
    addressv: 'clamp'
};

const loadEquirectTextureAsset = (app: AppBase, url: string): Promise<Asset> => {
    return new Promise((resolve, reject) => {
        const asset = new Asset('sca-panorama', 'texture', { url }, EQUIRECT_TEXTURE_DATA);

        asset.on('load', () => resolve(asset));
        asset.on('error', (err: string) => reject(new Error(err)));
        app.assets.add(asset);
        app.assets.load(asset);
    });
};

/** Load a 2:1 equirectangular image and apply it as an infinite camera-relative skybox. */
const applyEquirectSkybox = async (app: AppBase, url: string): Promise<Texture> => {
    const asset = await loadEquirectTextureAsset(app, url);
    const source = asset.resource as Texture;
    const cubemap = EnvLighting.generateSkyboxCubemap(source);
    app.scene.envAtlas = null;
    app.scene.skybox = cubemap;
    return cubemap;
};

const clearPanoramaSkybox = (app: AppBase): void => {
    app.scene.skybox = null;
    app.scene.envAtlas = null;
};

export {
    applyEquirectSkybox,
    clearPanoramaSkybox,
    loadEquirectTextureAsset
};
