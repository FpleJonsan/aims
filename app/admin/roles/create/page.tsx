"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Input as UiInput,
  Textarea as UiTextarea,
  Button as UiButton,
  Alert as UiAlert,
} from "../../../components/ui";
import { AuthApiError, authApiPost } from "../../../lib/auth-api";

export default function CreateRolePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await authApiPost<{ id: string }>("/admin/roles", { name, description: description.trim() || undefined });
      router.push(`/admin/roles/${result.id}`);
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not create the role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <UiPageHeader title="Create role" description="Permissions are assigned afterwards from the role's page or the permission matrix." />
      <UiCard style={{ maxWidth: 480 }}>
        <UiCardBody>
          <form onSubmit={onSubmit} noValidate>
            {error && <UiAlert tone="danger" title="Could not create role" style={{ marginBottom: 16 }}>{error}</UiAlert>}
            <UiInput label="Name" required value={name} onChange={(event) => setName(event.target.value)} />
            <UiTextarea label="Description" helper="Optional." value={description} onChange={(event) => setDescription(event.target.value)} />
            <UiButton type="submit" variant="primary" busy={busy} busyLabel="Creating…" style={{ width: "100%", marginTop: 8 }}>
              Create role
            </UiButton>
          </form>
        </UiCardBody>
      </UiCard>
    </div>
  );
}
