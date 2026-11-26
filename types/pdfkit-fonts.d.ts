// pdfkit ships its standard font metrics as separate modules (no bundled typings).
declare module "pdfkit/standard-fonts/*" {
  const font: { name: string; [k: string]: unknown };
  export default font;
}
