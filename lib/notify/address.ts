import type { Salutation } from "@prisma/client";

/**
 * How every customer-facing message addresses the customer:
 * "Mr. Amit Roy", "Mrs. Rina Das", "Ms. ...", "Dr. ...", or "Sir/Ma'am" when no salutation is set.
 */
export function addressCustomer(c: { customerName: string; customerSalutation: Salutation }): string {
  const name = c.customerName.trim().replace(/\s+/g, " ");
  switch (c.customerSalutation) {
    case "MR": return `Mr. ${name}`;
    case "MRS": return `Mrs. ${name}`;
    case "MS": return `Ms. ${name}`;
    case "DR": return `Dr. ${name}`;
    default: return "Sir/Ma'am";
  }
}

export const SALUTATION_LABELS: Record<Salutation, string> = {
  MR: "Mr.", MRS: "Mrs.", MS: "Ms.", DR: "Dr.", NONE: "Sir/Ma'am (no name)",
};
