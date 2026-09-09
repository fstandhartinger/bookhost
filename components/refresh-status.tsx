import { OnboardingRefresh } from "./onboarding-refresh";
export function RefreshStatus({ status }: { status: string }) {
  return (
    <>
      <OnboardingRefresh progress={status} />
      <p className="mt-3 text-xs text-slate-500" role="status">
        Status updates automatically while this tab is visible, every minute (up
        to five minutes if unchanged).
      </p>
    </>
  );
}
