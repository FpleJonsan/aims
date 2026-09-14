"use client";

import { MasterDataManager } from "../_shared/MasterDataManager";

export default function MasterDataDepartmentsPage() {
  return <MasterDataManager apiPath="/admin/master-data/departments" label="Department" pluralLabel="Departments" />;
}
