export function UiButton({ onMouseUp, ...props }) {
  return <button {...props} onMouseUp={(event) => { onMouseUp?.(event); event.currentTarget.blur(); }} />;
}
