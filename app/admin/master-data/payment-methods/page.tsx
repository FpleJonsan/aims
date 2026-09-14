"use client";

import { MasterDataManager } from "../_shared/MasterDataManager";

export default function PaymentMethodsPage() {
  return <MasterDataManager apiPath="/admin/master-data/payment-methods" label="Payment method" pluralLabel="Payment Methods" />;
}
