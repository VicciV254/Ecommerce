import { useId, useState } from 'react';
import { ordersAPI } from '../api/orders';
import { describeApiError } from '../api/errors';
import toast from 'react-hot-toast';
import { ModalDialog } from './Modal';

interface CancelOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  onOrderCancelled: () => void;
}

export default function CancelOrderModal({ isOpen, onClose, orderId, onOrderCancelled }: CancelOrderModalProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const reasonId = useId();

  const close = () => {
    if (isSubmitting) return;
    setErrorMessage('');
    setReason('');
    onClose();
  };

  const handleCancel = async () => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await ordersAPI.cancel(orderId, { reason });
      toast.success('Order cancelled successfully');
      onOrderCancelled();
      onClose();
      setReason('');
    } catch (error) {
      setErrorMessage(describeApiError(error, 'Failed to cancel order'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalDialog open={isOpen} label="Cancel Order" onClose={close}>
      <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain shadow-xl">
        <h2 className="text-xl font-semibold mb-4">Cancel Order</h2>
        <p className="text-gray-600 mb-4">
          Are you sure you want to cancel this order? If you've already paid, your order will be marked as awaiting refund approval.
        </p>
        
        <div className="mb-4">
          <label htmlFor={reasonId} className="block text-sm font-medium text-gray-700 mb-2">
            Reason for cancellation (optional)
          </label>
          <textarea
            id={reasonId}
            disabled={isSubmitting}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Please let us know why you're cancelling..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {errorMessage && <p role="alert" className="mb-4 text-sm text-error">{errorMessage}</p>}
        <div className="flex justify-end gap-3">
          <button
            onClick={close}
            disabled={isSubmitting}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
          >
            Keep Order
          </button>
          <button
            onClick={handleCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Cancelling...' : 'Cancel Order'}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
