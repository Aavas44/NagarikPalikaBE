declare module "html-to-docx" {
  type DocumentOptions = {
    table?: { row?: { cantSplit?: boolean } };
    footer?: boolean;
    pageNumber?: boolean;
    [key: string]: unknown;
  };

  function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: DocumentOptions,
    footerHTMLString?: string | null
  ): Promise<Buffer | ArrayBuffer | Blob>;

  export default HTMLtoDOCX;
}
