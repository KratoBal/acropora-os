import { CustomerDetailPage } from "@/components/customers/customer-detail-page";

export default async function VevoPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return <CustomerDetailPage customerId={customerId} />;
}
