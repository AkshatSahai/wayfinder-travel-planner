import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import changelogRaw from "../../../CHANGELOG.md?raw";

export const CURRENT_VERSION = /^## (v[\d.]+)/m.exec(changelogRaw)?.[1] ?? "v0.0.0";
const SEEN_KEY = "wayfinder.lastSeenVersion";

export function WhatsNewDialog() {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    setUnseen(localStorage.getItem(SEEN_KEY) !== CURRENT_VERSION);
  }, []);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      localStorage.setItem(SEEN_KEY, CURRENT_VERSION);
      setUnseen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button className="relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-active/50 hover:text-sidebar-foreground">
          <Sparkles className="h-4 w-4" />
          What's New
          <span className="ml-auto rounded-full bg-sidebar-active px-2 py-0.5 text-[10px] text-sidebar-foreground">
            {CURRENT_VERSION}
          </span>
          {unseen && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">What's New in Wayfinder</DialogTitle>
        </DialogHeader>
        <div className="text-sm leading-relaxed">
          <ReactMarkdown
            components={{
              h1: () => null,
              h2: ({ children }) => (
                <h2 className="mt-2 font-display text-xl font-semibold">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="mt-5 font-display text-lg font-semibold">{children}</h3>
              ),
              h4: ({ children }) => (
                <h4 className="mt-4 text-sm font-semibold uppercase tracking-wide text-primary">
                  {children}
                </h4>
              ),
              p: ({ children }) => <p className="mt-2 text-muted-foreground">{children}</p>,
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">{children}</strong>
              ),
              ul: ({ children }) => <ul className="mt-1 list-disc space-y-1 pl-5">{children}</ul>,
              li: ({ children }) => <li className="text-muted-foreground">{children}</li>,
            }}
          >
            {changelogRaw}
          </ReactMarkdown>
        </div>
      </DialogContent>
    </Dialog>
  );
}
