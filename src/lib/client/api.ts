/** fetch к нашему API: JSON туда и обратно, ошибка — с текстом от сервера. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Ошибка ${res.status}`);
  return body as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
