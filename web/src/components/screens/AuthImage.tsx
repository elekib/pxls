/** <img> for protected API images; the session cookie authenticates it. */
export function AuthImage({ src, ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img src={src} {...rest} />;
}
