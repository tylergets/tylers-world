export function Svg({ html, ...props }) {
  return <span {...props} dangerouslySetInnerHTML={{ __html: html }} />;
}

export const cssColor = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
