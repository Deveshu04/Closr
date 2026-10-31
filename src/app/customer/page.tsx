import type { Metadata } from "next";
import { CustomerApp } from "@/components/customer/CustomerApp";

export const metadata: Metadata = {
  title: "24x7 Help · Paytm",
  description: "Get a call back from Closr, Paytm's AI assistant, and watch your issue get fixed while you talk.",
};

export default function CustomerPage() {
  return <CustomerApp />;
}
