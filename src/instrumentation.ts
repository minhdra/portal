export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DATABASE_URL) {
    const { startJobs } = await import("./server/jobs");
    startJobs();
  }
}
