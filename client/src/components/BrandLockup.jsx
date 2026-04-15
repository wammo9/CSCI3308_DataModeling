import logoMark from "../assets/modelscope-mark.svg";

export default function BrandLockup({ compact = false, subtitle = "", className = "" }) {
  const classes = ["brand-lockup", compact ? "compact" : "large", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <img src={logoMark} alt="" className="brand-mark" />
      <div className="brand-copy">
        <span className="brand-name">ModelScope</span>
        {subtitle && <span className="brand-subtitle">{subtitle}</span>}
      </div>
    </div>
  );
}
