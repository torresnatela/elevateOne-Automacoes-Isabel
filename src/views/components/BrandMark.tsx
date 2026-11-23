import Image from "next/image";

const SIZES = { pequeno: 16, normal: 22, grande: 34 } as const;

/** O símbolo da ElevateOne num ladrilho neutro, com o brilho da marca à volta. */
export function BrandMark({ size = "normal" }: { size?: keyof typeof SIZES }) {
  const height = SIZES[size];
  return (
    <span className={size === "normal" ? "simbolo" : `simbolo ${size}`} aria-hidden="true">
      {/* (o logótipo tem 215 × 329) */}
      <Image src="/logo-mark.png" alt="" width={Math.round((height * 215) / 329)} height={height} />
    </span>
  );
}
