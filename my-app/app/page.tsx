import { createClient } from "@/lib/supabase/server";
import { Suspense } from "react";

async function InstrumentsTable() {
  const supabase = await createClient();
  const { data: instruments, error } = await supabase
      .from("instruments")
      .select()
      .order("id");

  if (error) {
    return (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Error loading instruments: {error.message}
        </p>
    );
  }

  if (!instruments?.length) {
    return (
        <p className="text-sm text-muted-foreground">No instruments found.</p>
    );
  }

  return (
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-6 py-3 font-medium">ID</th>
            <th scope="col" className="px-6 py-3 font-medium">Name</th>
          </tr>
          </thead>
          <tbody className="divide-y">
          {instruments.map((instrument) => (
              <tr
                  key={instrument.id}
                  className="transition-colors hover:bg-muted/50"
              >
                <td className="px-6 py-4 text-muted-foreground">
                  {instrument.id}
                </td>
                <td className="px-6 py-4 font-medium capitalize">
                  {instrument.name}
                </td>
              </tr>
          ))}
          </tbody>
        </table>
      </div>
  );
}

export default function Home() {
  return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          Instruments
        </h1>
        <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">
                Loading instruments...
              </p>
            }
        >
          <InstrumentsTable />
        </Suspense>
      </main>
  );
}