import { notFound } from "next/navigation";
import { NotFoundError, listProviders } from "@/lib/store/providers";
import { getSettings } from "@/lib/store/settings";
import { caseDetails, type CaseDetails } from "@/lib/trial/case-details";
import { ensureRecovered } from "@/lib/trial/runner";
import { CaseClient } from "./case-client";

export const dynamic = "force-dynamic";

export default async function CasePage({ params, searchParams }: PageProps<"/cases/[id]">) {
  const { id } = await params;
  const { fresh } = await searchParams;
  ensureRecovered();
  let details: CaseDetails;
  try {
    details = caseDetails(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { animationSpeed, fastMode } = getSettings();
  return (
    <CaseClient initial={details} providers={listProviders()} view={{ animationSpeed, fastMode }} startFresh={fresh === "1"} />
  );
}
