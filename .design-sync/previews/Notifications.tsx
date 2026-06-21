import { useEffect } from "react";
import { Notifications, notify } from "alice";

// Notifications renders the toast stack driven by `notify(...)` events and
// renders nothing until one fires. The preview mounts the stack and dispatches
// a couple of realistic toasts on mount so the card shows the populated state.
// (The <Notifications/> listener registers in its own effect, which React runs
// before this parent effect — so the events are never missed.)
export function Stack() {
  useEffect(() => {
    notify({
      title: "Import terminé",
      message: "510 questions ajoutées à la banque.",
      variant: "success",
      elapsed: 84,
    });
    notify({
      title: "Échec de la transcription",
      message: "Le service Deepgram n'a pas répondu.",
      variant: "error",
    });
  }, []);

  return <Notifications />;
}
