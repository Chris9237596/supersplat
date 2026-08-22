const regionMaskStorePath = (regionId: string): string => {
    return `regions/${regionId}.mask`;
};

const regionMaskZipPath = (regionId: string): string => {
    return `sca/regions/${regionId}.mask`;
};

const regionMaskMimeType = 'application/x-sca-region-mask';

export {
    regionMaskMimeType,
    regionMaskStorePath,
    regionMaskZipPath
};
