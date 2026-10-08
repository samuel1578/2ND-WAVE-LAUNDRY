import { Fragment } from "react";
import { splitHighlighted } from "@/lib/brand-highlight";

const glowClasses = (className?: string) =>
  `brand-glow${className ? ` ${className}` : ""}`;

export function BrandText({
  text,
  children,
  className,
}: {
  text?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const source =
    typeof text === "string"
      ? text
      : typeof children === "string"
        ? children
        : "";
  if (!source) return <>{children}</>;
  return (
    <>
      {splitHighlighted(source).map((part, index) =>
        part.match ? (
          <span
            key={`${part.text}-${index}`}
            className={glowClasses(className)}
          >
            {part.text}
          </span>
        ) : (
          <Fragment key={`${part.text}-${index}`}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

export function Glow({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return <span className={glowClasses(className)}>{children}</span>;
}
