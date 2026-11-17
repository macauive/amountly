"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

const COOKIE = "__Host-oai-ad-measurement";
const CHANGE = "ad-measurement-choice";

function snapshot() {
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl || location.protocol !== "https:") return "";
  if (document.cookie.split(";").some(part => part.trim().startsWith(COOKIE + "="))) return "active";
  const references = new URLSearchParams(location.search).getAll("oppref");
  if (references.length !== 1 || !/^[A-Za-z0-9_.=-]{1,1500}$/.test(references[0]) || location.pathname !== "/") return "";
  return "ref:" + references[0];
}

function subscribe(listener: () => void) {
  addEventListener(CHANGE, listener);
  addEventListener("popstate", listener);
  return () => {
    removeEventListener(CHANGE, listener);
    removeEventListener("popstate", listener);
  };
}

const serverSnapshot = () => "";

export function AdMeasurementConsent() {
  const pathname = usePathname();
  const choice = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [dismissed, setDismissed] = useState(false);
  if ((!pathname || !["/", "/signup", "/verify", "/privacy"].includes(pathname)) || !choice || (dismissed && choice !== "active")) return null;
  const updateCookie = (value: string, maxAge: number) => {
    document.cookie = COOKIE + "=" + value + "; Path=/; Secure; SameSite=Lax; Max-Age=" + maxAge;
    dispatchEvent(new Event(CHANGE));
    setDismissed(true);
  };
  return <aside aria-label="Optional ad measurement" className="mx-auto max-w-6xl px-4 py-3 text-sm [&_button]:mt-1 [&_button]:underline">
    {choice === "active" ? <button type="button" onClick={() => updateCookie("", 0)}>Turn off ad measurement</button> : <>
      <p>Allow OpenAI ad measurement? If you complete a signup, we share the event and an ad-click reference with OpenAI. Your choice is optional and expires after seven days.</p>
      <button type="button" onClick={() => updateCookie(crypto.randomUUID() + "~" + choice.slice(4), 604800)}>Allow measurement</button>{" "}
      <button type="button" onClick={() => setDismissed(true)}>Skip</button>
    </>}
  </aside>;
}
