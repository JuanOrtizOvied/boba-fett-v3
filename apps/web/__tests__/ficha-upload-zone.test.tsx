import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UploadZone from "@/components/admin/ficha-patrimonial/UploadZone";

function makeFile(name: string, sizeBytes: number): File {
  const file = new File([new Uint8Array(Math.max(sizeBytes, 0))], name);
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

describe("UploadZone idle state", () => {
  test("shows the .xlsx upload instructions", () => {
    render(<UploadZone onFileSelected={vi.fn()} />);
    expect(
      screen.getByText(/arrastr.*\.xlsx|\.xlsx.*arrastr/i),
    ).toBeInTheDocument();
  });
});

describe("UploadZone file selection via input", () => {
  test("valid .xlsx file calls onFileSelected and shows name + size", async () => {
    const user = userEvent.setup();
    const onFileSelected = vi.fn();
    render(<UploadZone onFileSelected={onFileSelected} />);
    const file = makeFile("ficha.xlsx", 2 * 1024 * 1024);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected).toHaveBeenCalledWith(file);
    expect(screen.getByText(/ficha\.xlsx/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
  });

  test("rejects a non-.xlsx file and does not call onFileSelected", async () => {
    // `accept=".xlsx"` already stops the native picker from offering other
    // extensions, but validateFichaFile() must still reject a mismatched
    // file that reaches the input another way (e.g. OS "all files" picker).
    // `applyAccept: false` bypasses userEvent's accept-attribute filtering
    // so the change event fires and the real validation path runs.
    const user = userEvent.setup({ applyAccept: false });
    const onFileSelected = vi.fn();
    render(<UploadZone onFileSelected={onFileSelected} />);
    const file = makeFile("ficha.csv", 1024);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(onFileSelected).not.toHaveBeenCalled();
    expect(
      screen.getByText("Solo se admiten archivos .xlsx"),
    ).toBeInTheDocument();
  });

  test("rejects an oversized .xlsx file and does not call onFileSelected", async () => {
    const user = userEvent.setup();
    const onFileSelected = vi.fn();
    render(<UploadZone onFileSelected={onFileSelected} />);
    const file = makeFile("ficha.xlsx", 11 * 1024 * 1024);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(onFileSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/supera el tamaño máximo/)).toBeInTheDocument();
  });
});

describe("UploadZone drag and drop", () => {
  test("shows a drop hint while dragging over, and reverts on drag leave", () => {
    render(<UploadZone onFileSelected={vi.fn()} />);
    const dropzone = screen.getByRole("button");

    fireEvent.dragOver(dropzone);
    expect(screen.getByText(/Solt.* el archivo/i)).toBeInTheDocument();

    fireEvent.dragLeave(dropzone);
    expect(screen.queryByText(/Solt.* el archivo/i)).not.toBeInTheDocument();
  });

  test("dropping a valid .xlsx file calls onFileSelected", () => {
    const onFileSelected = vi.fn();
    render(<UploadZone onFileSelected={onFileSelected} />);
    const dropzone = screen.getByRole("button");
    const file = makeFile("ficha.xlsx", 1024);

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });
});

describe("UploadZone disabled state", () => {
  test("does not accept a new drop while disabled", () => {
    const onFileSelected = vi.fn();
    render(<UploadZone onFileSelected={onFileSelected} disabled />);
    const dropzone = screen.getByRole("button");
    const file = makeFile("ficha.xlsx", 1024);

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(onFileSelected).not.toHaveBeenCalled();
  });
});
