import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Importer un cours · Skema" };

export default function UploadPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold">Importer un cours</h1>
      <p className="text-muted">
        PDF ou diaporama (PPTX, PPT, ODP), jusqu&apos;à 300 Mo. Le polycopié est découpé en chapitres ; tu
        choisis ensuite lesquels transformer en capsules.
      </p>
      <Suspense fallback={<p className="text-muted">Chargement…</p>}>
        <AuthenticatedForm />
      </Suspense>
    </main>
  );
}

async function AuthenticatedForm() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <UploadForm />;
}
