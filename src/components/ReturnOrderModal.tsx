import { useState, useRef } from "react";
import { ConfirmModal } from "./Modal";

interface ReturnOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  onReturn: (data: { reason: string; resolution: string; images: string[] }) => void;
}

export default function ReturnOrderModal({
  isOpen,
  onClose,
  orderId,
  onReturn,
}: ReturnOrderModalProps) {
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState("REFUND");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (!reason.trim()) {
      setError("Please provide a reason for the return");
      return;
    }
    setError("");
    onReturn({ reason, resolution, images });
    setReason("");
    setResolution("REFUND");
    setImages([]);
    onClose();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setUploading(true);
    const newImages: string[] = [];

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        newImages.push(reader.result as string);
        if (newImages.length === files.length) {
          setImages((prev) => [...prev, ...newImages]);
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleCameraCapture = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files[0]) {
        const reader = new FileReader();
        reader.onload = () => {
          setImages((prev) => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(target.files[0]);
      }
    };
    input.click();
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <ConfirmModal
      open={isOpen}
      title="Return Order"
      message="Please provide details for your return request."
      confirmLabel="Submit Return"
      cancelLabel="Cancel"
      onConfirm={handleSubmit}
      onCancel={onClose}
      confirmDisabled={!reason.trim()}
    >
      <div className="mt-4 space-y-4">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
            Reason for Return <span className="text-error">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError("");
            }}
            placeholder="Please explain why you want to return this order..."
            rows={4}
            className="w-full rounded-sm border border-light-gray px-3 py-2 text-xs focus:border-brand-secondary focus:outline-none"
            required
          />
          {error && <p className="mt-1 text-xs text-error">{error}</p>}
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
            Resolution
          </label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="w-full rounded-sm border border-light-gray px-3 py-2 text-xs focus:border-brand-secondary focus:outline-none"
          >
            <option value="REFUND">Refund</option>
            <option value="EXCHANGE">Exchange</option>
            <option value="STORE_CREDIT">Store Credit</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
            Images (Optional)
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-sm border border-light-gray px-3 py-2 text-xs hover:border-brand-secondary disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload Images"}
            </button>
            <button
              type="button"
              onClick={handleCameraCapture}
              className="rounded-sm border border-light-gray px-3 py-2 text-xs hover:border-brand-secondary"
            >
              Take Photo
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {images.map((img, index) => (
              <div key={index} className="relative">
                <img
                  src={img}
                  alt={`Return image ${index + 1}`}
                  className="h-20 w-full rounded-sm object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute right-1 top-1 rounded-full bg-error p-1 text-white hover:bg-red-700"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ConfirmModal>
  );
}
