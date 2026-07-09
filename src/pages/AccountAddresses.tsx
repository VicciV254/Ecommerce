// src/pages/AccountAddresses.tsx
import { useState, FormEvent } from 'react';
import { useAuth, Address } from '../contexts/AuthContext';

export default function AccountAddresses() {
  const { user, addAddress, updateAddress, deleteAddress } = useAuth();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Omit<Address, 'id'>>({
    street: '',
    city: '',
    county: '',
    postalCode: '',
    isDefault: false,
  });

  const addresses: Address[] = user?.addresses || [];

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateAddress(editingId, formData);
      } else {
        await addAddress(formData);
      }
      setFormData({ street: '', city: '', county: '', postalCode: '', isDefault: false });
      setEditingId(null);
    } catch (error) {
      console.error('Failed to save address:', error);
    }
  };

  const handleEdit = (address: Address) => {
    setEditingId(address.id);
    setFormData({
      street: address.street,
      city: address.city,
      county: address.county,
      postalCode: address.postalCode,
      isDefault: address.isDefault,
    });
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this address?')) {
      try {
        await deleteAddress(id);
      } catch (error) {
        console.error('Failed to delete address:', error);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h2 className="text-2xl font-display mb-6">My Addresses</h2>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-card mb-8">
        <h3 className="text-lg font-semibold mb-4">
          {editingId ? 'Edit Address' : 'Add New Address'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            type="text"
            name="street"
            value={formData.street}
            onChange={handleChange}
            placeholder="Street Address"
            className="p-2 border rounded"
            required
          />
          <input
            type="text"
            name="city"
            value={formData.city}
            onChange={handleChange}
            placeholder="City"
            className="p-2 border rounded"
            required
          />
          <input
            type="text"
            name="county"
            value={formData.county}
            onChange={handleChange}
            placeholder="County"
            className="p-2 border rounded"
            required
          />
          <input
            type="text"
            name="postalCode"
            value={formData.postalCode}
            onChange={handleChange}
            placeholder="Postal Code"
            className="p-2 border rounded"
          />
          <div className="flex items-center gap-2 col-span-full">
            <input
              type="checkbox"
              name="isDefault"
              checked={formData.isDefault}
              onChange={handleChange}
              className="w-4 h-4"
            />
            <label>Set as default address</label>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button type="submit" className="btn-primary">
            {editingId ? 'Update Address' : 'Add Address'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setFormData({ street: '', city: '', county: '', postalCode: '', isDefault: false });
              }}
              className="btn-outline"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {addresses.map((address: Address) => (
          <div key={address.id} className="bg-white p-4 rounded-lg shadow-card border border-gray-100">
            <p className="font-medium">{address.street}</p>
            <p>{address.city}, {address.county}</p>
            {address.postalCode && <p className="text-sm text-gray-500">Postal: {address.postalCode}</p>}
            {address.isDefault && (
              <span className="inline-block mt-2 text-xs bg-gold/10 text-gold px-2 py-1 rounded">
                Default
              </span>
            )}
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => handleEdit(address)}
                className="text-blue-600 hover:underline text-sm"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(address.id)}
                className="text-red-600 hover:underline text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {addresses.length === 0 && (
        <p className="text-gray-500 text-center py-8">No addresses saved yet.</p>
      )}
    </div>
  );
}