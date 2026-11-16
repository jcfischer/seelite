### Pixel ratio 1

ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version) | pixel ratio 1 | build 8a5903a1cec3c6887c41c3885a8dff333b973500 | GPU lane (SEELITE_PROBE_RENDERER=hardware, headed)

- S1: view-set/planet-close-detail-sweep1-ratio1.json, order seed 20261027, drift control 4.86 -> 5.16 ms, widest column floor 4.77 ms, no excursion
- S2: view-set/planet-close-detail-sweep2-ratio1.json, order seed 20261028, drift control 4.39 -> 5.33 ms, widest column floor 3.92 ms, no excursion

Frame time, ms (S1 / S2):

| arm | 200R | 2R | 1.6R | 1.5R | 1.2R |
|---|---:|---:|---:|---:|---:|
| interim | 4.97 / 5.21 | 5.59 / 5.12 | 6.90 / 6.90 | 6.91 / 7.54 | 6.95 / 6.95 |
| cap-0 | 4.77 / 4.12 | 5.65 / 5.56 | 6.65 / 6.68 | 6.76 / 6.66 | 6.96 / 6.88 |
| cap-2 | 4.98 / 4.31 | 5.75 / 5.40 | 6.59 / 6.36 | 6.70 / 6.58 | 6.85 / 6.97 |
| cap-4 | 5.01 / 5.27 | 5.51 / 5.43 | 6.83 / 6.90 | 7.05 / 6.75 | 6.82 / 6.69 |
| cap-6 | 4.86 / 4.71 | 5.53 / 5.12 | 6.63 / 6.96 | 6.99 / 6.61 | 7.25 / 6.11 |
| full-res | 5.16 / 3.92 | 6.71 / 7.04 | 7.82 / 7.78 | 8.47 / 8.54 | 9.06 / 9.29 |
| analytic-gradient | 4.91 / 4.95 | 5.49 / 4.81 | 6.87 / 6.80 | 7.06 / 6.95 | 7.57 / 7.23 |
| clouds-at-ground | 5.06 / 4.68 | 5.03 / 6.17 | 6.59 / 6.18 | 6.68 / 6.61 | 7.25 / 6.96 |

Delta against interim, ms (S1 / S2):

| arm | 2R | 1.6R | 1.5R | 1.2R |
|---|---:|---:|---:|---:|
| cap-0 | +0.07 / +0.44 | -0.24 / -0.22 | -0.15 / -0.88 | +0.01 / -0.07 |
| cap-2 | +0.16 / +0.28 | -0.31 / -0.54 | -0.21 / -0.96 | -0.10 / +0.02 |
| cap-4 | -0.08 / +0.31 | -0.07 / -0.00 | +0.14 / -0.79 | -0.13 / -0.26 |
| cap-6 | -0.05 / +0.00 | -0.27 / +0.06 | +0.08 / -0.94 | +0.30 / -0.84 |
| full-res | +1.12 / +1.93 | +0.92 / +0.87 | +1.56 / +1.00 | +2.11 / +2.34 |
| analytic-gradient | -0.10 / -0.31 | -0.03 / -0.10 | +0.15 / -0.59 | +0.62 / +0.28 |
| clouds-at-ground | -0.56 / +1.06 | -0.30 / -0.72 | -0.24 / -0.93 | +0.30 / +0.01 |

Delta against cap-0, ms (S1 / S2):

| arm | 2R | 1.6R | 1.5R | 1.2R |
|---|---:|---:|---:|---:|
| interim | -0.07 / -0.44 | +0.24 / +0.22 | +0.15 / +0.88 | -0.01 / +0.07 |
| cap-2 | +0.10 / -0.16 | -0.07 / -0.33 | -0.06 / -0.07 | -0.10 / +0.09 |
| cap-4 | -0.15 / -0.13 | +0.18 / +0.21 | +0.29 / +0.09 | -0.14 / -0.19 |
| cap-6 | -0.12 / -0.44 | -0.03 / +0.27 | +0.23 / -0.05 | +0.29 / -0.77 |

S1 read again: no cell.
S2 read again: full-res@200R (discarded 4.2,8.2,5.3,4.2,4.3); cap-0@2R (discarded 5.9,5.6,4.3,3.8,4.0).

S1 and S2 disagree on a close cell by a median of 0.23 ms and at most 1.14 ms (clouds-at-ground at 2R).

### Pixel ratio 2

ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version) | pixel ratio 2 | build 8a5903a1cec3c6887c41c3885a8dff333b973500 | GPU lane (SEELITE_PROBE_RENDERER=hardware, headed)

- S1: view-set/planet-close-detail-sweep1-ratio2.json, order seed 20261027, drift control 5.34 -> 5.90 ms, widest column floor 3.67 ms, no excursion
- S2: view-set/planet-close-detail-sweep2-ratio2.json, order seed 20261028, drift control 5.71 -> 6.01 ms, widest column floor 5.57 ms, no excursion
- S3: view-set/planet-close-detail-sweep3-ratio2.json, order seed 20261029, drift control 5.65 -> 5.16 ms, widest column floor 4.07 ms, no excursion

Frame time, ms (S1 / S2 / S3):

| arm | 200R | 2R | 1.6R | 1.5R | 1.2R |
|---|---:|---:|---:|---:|---:|
| interim | 3.67 / 5.77 / 5.76 | 8.58 / 8.77 / 8.45 | 12.59 / 12.64 / 12.59 | 14.10 / 13.99 / 13.99 | 15.72 / 15.87 / 15.77 |
| cap-0 | 5.17 / 5.76 / 5.57 | 8.21 / 8.33 / 8.36 | 10.67 / 10.74 / 10.67 | 11.60 / 11.66 / 11.47 | 11.79 / 11.76 / 11.67 |
| cap-2 | 4.05 / 5.69 / 4.76 | 9.15 / 8.77 / 8.48 | 11.75 / 12.00 / 11.67 | 14.53 / 12.76 / 12.85 | 13.39 / 13.23 / 13.39 |
| cap-4 | 3.76 / 6.18 / 5.81 | 8.80 / 8.67 / 8.80 | 12.63 / 12.59 / 12.55 | 13.91 / 13.68 / 13.87 | 15.02 / 14.84 / 14.84 |
| cap-6 | 5.65 / 5.62 / 5.57 | 8.59 / 8.85 / 8.50 | 12.90 / 12.66 / 12.63 | 16.47 / 14.12 / 14.08 | 18.02 / 15.75 / 15.80 |
| full-res | 5.90 / 5.69 / 4.07 | 14.58 / 14.43 / 14.79 | 22.57 / 22.57 / 22.94 | 27.40 / 26.04 / 25.13 | 29.59 / 29.50 / 29.50 |
| analytic-gradient | 5.33 / 6.03 / 5.53 | 10.03 / 9.97 / 9.94 | 17.36 / 14.90 / 14.93 | 16.86 / 16.89 / 16.92 | 19.19 / 19.12 / 19.23 |
| clouds-at-ground | 5.46 / 5.57 / 5.78 | 8.64 / 8.65 / 8.65 | 12.20 / 12.18 / 12.45 | 13.51 / 13.51 / 13.85 | 15.41 / 15.34 / 15.38 |

Delta against interim, ms (S1 / S2 / S3):

| arm | 2R | 1.6R | 1.5R | 1.2R |
|---|---:|---:|---:|---:|
| cap-0 | -0.37 / -0.45 / -0.08 | -1.92 / -1.90 / -1.92 | -2.50 / -2.33 / -2.52 | -3.93 / -4.11 / -4.10 |
| cap-2 | +0.57 / +0.00 / +0.04 | -0.84 / -0.64 / -0.93 | +0.43 / -1.23 / -1.13 | -2.34 / -2.65 / -2.39 |
| cap-4 | +0.22 / -0.11 / +0.35 | +0.03 / -0.05 / -0.05 | -0.20 / -0.31 / -0.12 | -0.71 / -1.04 / -0.94 |
| cap-6 | +0.01 / +0.08 / +0.06 | +0.31 / +0.02 / +0.03 | +2.37 / +0.14 / +0.10 | +2.29 / -0.12 / +0.02 |
| full-res | +5.99 / +5.66 / +6.35 | +9.98 / +9.93 / +10.34 | +13.29 / +12.06 / +11.14 | +13.86 / +13.63 / +13.73 |
| analytic-gradient | +1.45 / +1.20 / +1.49 | +4.77 / +2.26 / +2.33 | +2.76 / +2.91 / +2.93 | +3.47 / +3.25 / +3.46 |
| clouds-at-ground | +0.06 / -0.12 / +0.20 | -0.40 / -0.46 / -0.14 | -0.59 / -0.47 / -0.14 | -0.31 / -0.54 / -0.39 |

Delta against cap-0, ms (S1 / S2 / S3):

| arm | 2R | 1.6R | 1.5R | 1.2R |
|---|---:|---:|---:|---:|
| interim | +0.37 / +0.45 / +0.08 | +1.92 / +1.90 / +1.92 | +2.50 / +2.33 / +2.52 | +3.93 / +4.11 / +4.10 |
| cap-2 | +0.94 / +0.45 / +0.12 | +1.08 / +1.26 / +1.00 | +2.93 / +1.10 / +1.39 | +1.59 / +1.46 / +1.72 |
| cap-4 | +0.59 / +0.34 / +0.43 | +1.95 / +1.85 / +1.87 | +2.31 / +2.02 / +2.40 | +3.22 / +3.07 / +3.17 |
| cap-6 | +0.38 / +0.52 / +0.14 | +2.23 / +1.92 / +1.95 | +4.87 / +2.47 / +2.62 | +6.23 / +3.98 / +4.13 |

S1 read again: cap-6@1.6R (discarded 25.6,14.1,12.5,12.7,12.8); cap-6@1.5R (discarded 29.6,19.4,13.8,14.1,14.3).
S2 read again: cap-2@1.6R (discarded 30.8,31.1,29.8,15.2,11.7); cap-0@1.5R (discarded 25.6,14.5,11.2,11.3,11.4).
S3 read again: clouds-at-ground@1.5R (discarded 24.4,24.1,13.2,13.8,13.3).

S1 and S2 disagree on a close cell by a median of 0.14 ms and at most 2.46 ms (analytic-gradient at 1.6R).
S1 and S3 disagree on a close cell by a median of 0.12 ms and at most 2.44 ms (analytic-gradient at 1.6R).
S2 and S3 disagree on a close cell by a median of 0.10 ms and at most 0.92 ms (full-res at 1.5R).

