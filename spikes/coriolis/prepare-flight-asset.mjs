// Run after Blender's --flight export. Lossless geometry and texture encoding:
// no simplification, quantization, resizing or changes to the authored surface.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder': MeshoptEncoder});
const document = await io.read('.dream-loop/coriolis-industrial-flight.glb');
await document.transform(dedup(), reorder({encoder: MeshoptEncoder}), textureCompress({encoder: sharp, targetFormat: 'webp', lossless: true}));
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method: EXTMeshoptCompression.EncoderMethod.QUANTIZE});
await mkdir('public/models', {recursive: true});
await io.write('public/models/coriolis.glb', document);
