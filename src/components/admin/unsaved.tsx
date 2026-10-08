"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/dialog";
export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [destination, setDestination] = useState("");
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      const anchor = (e.target as Element)?.closest("a");
      if (
        !anchor ||
        !anchor.href ||
        anchor.target === "_blank" ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        anchor.getAttribute("href")?.startsWith("#")
      )
        return;
      if (anchor.href === location.href) return;
      e.preventDefault();
      e.stopPropagation();
      setDestination(anchor.href);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
  return (
    <Dialog
      open={!!destination}
      onClose={() => setDestination("")}
      title="Unsaved changes"
    >
      <p>You have unsaved changes. Leave this page?</p>
      <div className="actions">
        <button className="button secondary" onClick={() => setDestination("")}>
          Cancel
        </button>
        <button
          className="button danger"
          onClick={() => {
            const url = new URL(destination);
            setDestination("");
            if (url.origin === location.origin)
              router.push(url.pathname + url.search);
            else location.assign(url.href);
          }}
        >
          Leave Page
        </button>
      </div>
    </Dialog>
  );
}
