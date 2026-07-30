/** Pure guard used immediately before any post-transport write or state commit. */
export function mayCommitInfoOSDownload(signal: Pick<AbortSignal, "aborted"> | undefined): boolean {
  return !signal?.aborted;
}

export type InfoOSDownloadPhase = "downloading" | "cancelled" | "committing" | "complete";

/**
 * Downloading is cancellable and write-free. Once beginCommit succeeds, callers
 * remove their cancel control and finish the local commit without the signal.
 */
export class InfoOSDownloadSession {
  private readonly controller = new AbortController();
  private currentPhase: InfoOSDownloadPhase = "downloading";

  get signal(): AbortSignal { return this.controller.signal; }
  get phase(): InfoOSDownloadPhase { return this.currentPhase; }
  get canCancel(): boolean { return this.currentPhase === "downloading"; }

  cancel(): boolean {
    if (!this.canCancel) return false;
    this.currentPhase = "cancelled";
    this.controller.abort();
    return true;
  }

  beginCommit(): boolean {
    if (!this.canCancel || this.controller.signal.aborted) return false;
    this.currentPhase = "committing";
    return true;
  }

  complete(): void {
    if (this.currentPhase === "committing") this.currentPhase = "complete";
  }
}
