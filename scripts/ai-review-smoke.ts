// Temporary integration fixture; its PR is closed after testing, without merging.
export function hasAiReviewLabel(labels: readonly string[]): boolean {
  return labels.includes('ai review');
}
