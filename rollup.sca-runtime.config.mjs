import path from 'path';

import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

const BUILD_TYPE = process.env.BUILD_TYPE || 'release';

const scaRuntimeModule = (input, file) => ({
    input,
    output: {
        file,
        format: 'iife',
        sourcemap: true
    },
    plugins: [
        typescript({
            tsconfig: './tsconfig.json'
        }),
        resolve(),
        BUILD_TYPE !== 'debug' && terser()
    ].filter(Boolean),
    treeshake: 'smallest'
});

export default [
    scaRuntimeModule('src/sca/runtime/sca-picker-entry.ts', 'static/sca/sca-picker.js'),
    scaRuntimeModule('src/sca/runtime/sca-region-core-entry.ts', 'static/sca/sca-region-core.js')
];
