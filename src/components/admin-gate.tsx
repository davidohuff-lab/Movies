"use client";

import { useState } from "react";

export function AdminGate() {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret })
    });
    if (!response.ok) {
      setError("Invalid secret");
      return;
    }
    window.location.reload();
  }

  return (
    <section className="admin-gate">
      <p className="eyebrow">Hidden admin mode</p>
      <h1>Projection Room</h1>
      <form className="gate-form" onSubmit={submit}>
        <label>
          Admin secret
          <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} />
        </label>
        <button type="submit" className="primary-button">
          Enter
        </button>
        {error ? <p className="error-text">{error}</p> : null}
      </form>
    </section>
  );
}
