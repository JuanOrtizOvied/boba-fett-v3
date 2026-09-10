"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { FileIcon } from "@/components/icons/Icons";
import { formatFileSize, validateFichaFile } from "./fichaUploadShared";

interface UploadZoneProps {
  /** Called once with a validated `.xlsx` File, from either the file picker or a drop. */
  onFileSelected: (file: File) => void;
  /** Disables further selection while a parse is already in flight. */
  disabled?: boolean;
}

/**
 * Drag-and-drop / click-to-browse zone for the Ficha Patrimonial upload flow
 * (`sdd/admin-ficha-patrimonial/spec` -> "Ficha Upload Page"). Only accepts
 * `.xlsx` files up to 10MB — see `fichaUploadShared.validateFichaFile()`.
 * Upload itself (calling the parse endpoint) is orchestrated by the parent
 * page via `onFileSelected`; this component only picks and validates the file.
 */
export default function UploadZone({
  onFileSelected,
  disabled = false,
}: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | null | undefined) => {
    if (!file || disabled) return;
    const validationError = validateFichaFile(file);
    if (validationError) {
      setLocalError(validationError);
      setSelectedFile(null);
      return;
    }
    setLocalError(null);
    setSelectedFile(file);
    onFileSelected(file);
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0]);
    // Allow re-selecting the same file twice in a row (e.g. after fixing it).
    e.target.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          disabled
            ? "cursor-not-allowed border-sabbi-neutral-200 opacity-60"
            : isDragOver
              ? "cursor-pointer border-sabbi-primary bg-[#f0fcd4]"
              : "cursor-pointer border-sabbi-neutral-200 hover:border-sabbi-neutral-300"
        }`}
      >
        <FileIcon size={32} className="text-sabbi-neutral-500" />
        {isDragOver ? (
          <p className="text-sm font-medium text-sabbi-neutral-900">
            Soltá el archivo aquí
          </p>
        ) : (
          <p className="text-sm text-sabbi-neutral-600">
            Arrastrá tu ficha patrimonial (.xlsx) o hacé clic para elegir el
            archivo
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          disabled={disabled}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {selectedFile && !localError && (
        <p className="text-sm text-sabbi-neutral-700">
          {selectedFile.name} · {formatFileSize(selectedFile.size)}
        </p>
      )}
      {localError && <p className="text-sm text-red-600">{localError}</p>}
    </div>
  );
}
