/**
 * PCA module using ml-pca.
 *
 * The ml-pca package performs SVD-based PCA internally with optional centering
 * and scaling. By default we center + scale so that columns with different
 * units don't dominate the principal components.
 */
import { PCA } from 'ml-pca';

/**
 * Runs PCA on a 2-D numeric matrix.
 *
 * @param {number[][]} matrix  - n_samples x n_features array of numbers
 * @param {number}     nComponents - how many PCs to return (2 or 3)
 * @param {{ scale?: boolean }} [options]
 * @returns {{
 *   transformed: number[][],
 *   explainedVarianceRatio: number[],
 *   allExplainedVariance: number[],
 *   loadings: number[][],
 *   totalExplained: number,
 *   nComponents: number,
 *   nSamples: number
 * }}
 */
export function runPCA(matrix, nComponents, options = {}) {
  if (!Array.isArray(matrix) || matrix.length < 2) {
    throw new Error('Need at least 2 samples to perform PCA.');
  }

  const nFeatures = matrix[0].length;
  if (nFeatures < 2) {
    throw new Error('Need at least 2 quantitative features for PCA.');
  }

  // Clamp nComponents to what is actually achievable.
  const k = Math.min(nComponents, nFeatures, matrix.length - 1);

  // center: subtract column means; scale: divide by column std dev.
  const pca = new PCA(matrix, { center: true, scale: options.scale !== false });

  // predict() projects the data onto the first k PCs.
  const scoresMatrix = pca.predict(matrix, { nComponents: k });
  const transformed = scoresMatrix.to2DArray();

  // getExplainedVariance() returns fractions (each component / total variance).
  const allEV = pca.getExplainedVariance();
  const explainedVarianceRatio = allEV.slice(0, k);
  const loadings = pca.getLoadings().to2DArray().slice(0, k);
  const totalExplained = explainedVarianceRatio.reduce((s, v) => s + v, 0);

  return {
    transformed,
    explainedVarianceRatio,
    allExplainedVariance: allEV,
    loadings,
    totalExplained,
    nComponents: k,
    nSamples: matrix.length,
  };
}
