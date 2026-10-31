import { atIst, istDateKey, normalizePhone, shiftDateKey } from "@/lib/format";
import { RETURN_PICKUP_SCAN, refundMethodFor } from "@/lib/policy";
import type { Address, Customer, Invoice, LineItem, Order, Refund, ShipmentEvent, Ticket } from "@/lib/types";

export const STORE = {
  name: "Nimbus",
  legalName: "Nimbus Consumer Electronics Pvt. Ltd.",
  gstin: "07AAKCN4821M1Z5",
  invoicePrefix: "NB",
} as const;

export const DEMO_CUSTOMER_ID = "CUST-1001";

/** The story beats the voice demo relies on. */
export const DEMO_ORDERS = {
  refundStuckInQc: "NB-24117",
  refundNeedsApproval: "NB-23891",
  inTransit: "NB-24402",
  invoiceReady: "NB-24203",
} as const;

export interface SeedData {
  customers: Customer[];
  orders: Order[];
  invoices: Invoice[];
  refunds: Refund[];
  tickets: Ticket[];
}

const PRODUCTS = {
  headphones: { sku: "NB-AUD-PULSE2", name: "Pulse ANC Wireless Headphones", price: 2499 },
  smartwatch: { sku: "NB-WR-ORBITPRO", name: "Orbit Pro AMOLED Smartwatch", price: 7999 },
  powerBank: { sku: "NB-PWR-AERO20K", name: "Aero 20000mAh Power Bank", price: 1799 },
  charger: { sku: "NB-PWR-SNAP65", name: "Snap 65W GaN Charger", price: 1599 },
  keyboard: { sku: "NB-PC-GLIDE87", name: "Glide 87-Key Mechanical Keyboard", price: 3299 },
  earbuds: { sku: "NB-AUD-NOVATWS", name: "Nova TWS Earbuds", price: 1499 },
  speaker: { sku: "NB-AUD-HALO", name: "Halo Smart Speaker", price: 4499 },
  deskLamp: { sku: "NB-HOME-LUMEN", name: "Lumen Smart Desk Lamp", price: 1299 },
  backpack: { sku: "NB-BAG-TREK25", name: "Trek 25L Laptop Backpack", price: 1899 },
  actionCamera: { sku: "NB-CAM-PIX4K", name: "Pixel 4K Action Camera", price: 6499 },
  blender: { sku: "NB-HOME-BREW", name: "Brew Portable Blender", price: 1999 },
} satisfies Record<string, Omit<LineItem, "qty">>;

function line(product: Omit<LineItem, "qty">, qty = 1): LineItem {
  return { ...product, qty };
}

function totalOf(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

interface Journey {
  origin: string;
  hub: string;
  doorstep: string;
  manifestedAt?: string;
  shippedAt?: string;
  reachedHubAt?: string;
  outForDeliveryAt?: string;
  deliveredAt?: string;
  returnRequestedAt?: string;
  returnPickedAt?: string;
  returnReceivedAt?: string;
  qcPassedAt?: string;
}

function trackingEvents(journey: Journey): ShipmentEvent[] {
  const steps: [string | undefined, string, string][] = [
    [journey.manifestedAt, "Shipment manifested", journey.origin],
    [journey.shippedAt, "Picked up from seller", journey.origin],
    [journey.reachedHubAt, "Reached destination hub", journey.hub],
    [journey.outForDeliveryAt, "Out for delivery", journey.hub],
    [journey.deliveredAt, "Delivered", journey.doorstep],
    [journey.returnRequestedAt, "Return pickup scheduled", journey.hub],
    [journey.returnPickedAt, RETURN_PICKUP_SCAN, journey.doorstep],
    [journey.returnReceivedAt, "Return received at warehouse", journey.origin],
    [journey.qcPassedAt, "QC passed", journey.origin],
  ];
  return steps
    .filter((step): step is [string, string, string] => step[0] !== undefined)
    .map(([at, status, location]) => ({ at, status, location }));
}

function financialYear(iso: string): string {
  const [year, month] = istDateKey(new Date(iso)).split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

function invoiceFor(order: Order, issuedAt: string, sequence: number): Invoice {
  const subtotal = Math.round((order.total / 1.18) * 100) / 100;
  return {
    id: `INV-${order.id.replace(/^NB-/, "")}`,
    number: `${STORE.invoicePrefix}/${financialYear(issuedAt)}/${String(sequence).padStart(6, "0")}`,
    orderId: order.id,
    customerId: order.customerId,
    issuedAt,
    subtotal,
    gst: Math.round((order.total - subtotal) * 100) / 100,
    total: order.total,
    gstin: STORE.gstin,
  };
}

function emailFromName(name: string): string {
  const handle = name.trim().toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
  return `${handle || "customer"}@gmail.com`;
}

export function createSeed(now: Date = new Date()): SeedData {
  const today = istDateKey(now);
  const latest = now.getTime() - 5 * 60_000;
  const past = (daysAgo: number, hour: number, minute = 0) =>
    new Date(Math.min(atIst(shiftDateKey(today, -daysAgo), hour, minute).getTime(), latest)).toISOString();
  const ahead = (days: number, hour: number, minute = 0) =>
    atIst(shiftDateKey(today, days), hour, minute).toISOString();

  const demoName = process.env.DEMO_CUSTOMER_NAME?.trim() || "Deveshu Pathak";
  const demoPhone = normalizePhone(process.env.DEMO_CUSTOMER_PHONE?.trim() || "+919999999999");

  const customers: Customer[] = [
    {
      id: DEMO_CUSTOMER_ID,
      name: demoName,
      phone: demoPhone,
      email: process.env.DEMO_CUSTOMER_EMAIL?.trim() || emailFromName(demoName),
      city: "Delhi",
      language: "hinglish",
      tier: "vip",
      flags: [],
      lifetimeValue: 31640,
    },
    {
      id: "CUST-1002",
      name: "Ananya Iyer",
      phone: "+919845012345",
      email: "ananya.iyer@outlook.com",
      city: "Bengaluru",
      language: "english",
      tier: "vip",
      flags: [],
      lifetimeValue: 41200,
    },
    {
      id: "CUST-1003",
      name: "Rohit Malhotra",
      phone: "+919820045671",
      email: "rohit.malhotra88@gmail.com",
      city: "Mumbai",
      language: "hinglish",
      tier: "regular",
      flags: ["repeat_refund"],
      lifetimeValue: 14180,
    },
    {
      id: "CUST-1004",
      name: "Priya Nair",
      phone: "+919746023118",
      email: "priya.nair@yahoo.in",
      city: "Kochi",
      language: "english",
      tier: "regular",
      flags: [],
      lifetimeValue: 9870,
    },
    {
      id: "CUST-1005",
      name: "Sunita Verma",
      phone: "+919415067823",
      email: "sunita.verma1975@gmail.com",
      city: "Lucknow",
      language: "hindi",
      tier: "new",
      flags: [],
      lifetimeValue: 1899,
    },
    {
      id: "CUST-1006",
      name: "Karan Gill",
      phone: "+919872034561",
      email: "karangill.chd@gmail.com",
      city: "Chandigarh",
      language: "hinglish",
      tier: "regular",
      flags: [],
      lifetimeValue: 12340,
    },
  ];

  const delhiHome: Address = {
    line1: "H-34, Second Floor, Lajpat Nagar II",
    line2: "Near Central Market",
    city: "New Delhi",
    pincode: "110024",
  };
  const bengaluruHome: Address = {
    line1: "No. 48, 3rd Cross, Indiranagar 2nd Stage",
    line2: "Opp. Ullas Park",
    city: "Bengaluru",
    pincode: "560038",
  };
  const mumbaiHome: Address = {
    line1: "B-702, Raheja Classique, New Link Road",
    line2: "Andheri West",
    city: "Mumbai",
    pincode: "400053",
  };
  const kochiHome: Address = {
    line1: "Flat 5C, Skyline Ivy League",
    line2: "Kakkanad",
    city: "Kochi",
    pincode: "682030",
  };
  const lucknowHome: Address = { line1: "C-1/214, Sector J, Aliganj", city: "Lucknow", pincode: "226024" };
  const chandigarhHome: Address = { line1: "House 1123, Sector 21B", city: "Chandigarh", pincode: "160022" };

  const northFc = "Nimbus FC, Bilaspur, Gurugram";
  const southFc = "Nimbus FC, Hoskote, Bengaluru";
  const westFc = "Nimbus FC, Bhiwandi, Thane";

  const orders: Order[] = [];
  const invoiceDates = new Map<string, string>();

  // a. Headline case: return picked up 6 days ago, QC stuck past the SLA, refund never started.
  {
    const items = [line(PRODUCTS.headphones)];
    const journey: Journey = {
      origin: northFc,
      hub: "Delhivery Okhla Hub, New Delhi",
      doorstep: "Lajpat Nagar II, New Delhi",
      shippedAt: past(18, 11, 30),
      reachedHubAt: past(16, 6, 5),
      outForDeliveryAt: past(15, 8, 40),
      deliveredAt: past(15, 14, 22),
      returnRequestedAt: past(8, 19, 5),
      returnPickedAt: past(6, 16, 12),
      returnReceivedAt: past(5, 11, 40),
    };
    orders.push({
      id: DEMO_ORDERS.refundStuckInQc,
      customerId: DEMO_CUSTOMER_ID,
      items,
      total: totalOf(items),
      status: "return_picked",
      placedAt: past(19, 21, 14),
      deliveredAt: journey.deliveredAt,
      address: delhiHome,
      payment: { method: "UPI", ref: "431598207164" },
      shipment: {
        courier: "Delhivery",
        awb: "1490817263541",
        status: "Return received at warehouse",
        events: trackingEvents(journey),
      },
      return: {
        reason: "Left ear cup crackles at high volume",
        requestedAt: journey.returnRequestedAt!,
        pickedAt: journey.returnPickedAt,
        qcStatus: "pending",
        qcSince: journey.returnReceivedAt,
      },
    });
    invoiceDates.set(DEMO_ORDERS.refundStuckInQc, journey.shippedAt!);
  }

  // b. QC passed 3 days ago, refund never initiated, and above the auto-approve limit.
  {
    const items = [line(PRODUCTS.smartwatch)];
    const journey: Journey = {
      origin: northFc,
      hub: "Blue Dart Mathura Road Hub, New Delhi",
      doorstep: "Lajpat Nagar II, New Delhi",
      shippedAt: past(23, 10, 15),
      reachedHubAt: past(22, 5, 50),
      outForDeliveryAt: past(21, 9, 10),
      deliveredAt: past(21, 15, 48),
      returnRequestedAt: past(7, 12, 30),
      returnPickedAt: past(5, 11, 5),
      returnReceivedAt: past(4, 18, 20),
      qcPassedAt: past(3, 15, 0),
    };
    orders.push({
      id: DEMO_ORDERS.refundNeedsApproval,
      customerId: DEMO_CUSTOMER_ID,
      items,
      total: totalOf(items),
      status: "return_picked",
      placedAt: past(24, 13, 2),
      deliveredAt: journey.deliveredAt,
      address: delhiHome,
      payment: { method: "Card", ref: "pay_P4xQk2LmZ8aR1d" },
      shipment: {
        courier: "Blue Dart",
        awb: "50917364028",
        status: "Return QC passed",
        events: trackingEvents(journey),
      },
      return: {
        reason: "Battery drains within 10 hours",
        requestedAt: journey.returnRequestedAt!,
        pickedAt: journey.returnPickedAt,
        qcStatus: "passed",
        qcSince: journey.qcPassedAt,
      },
    });
    invoiceDates.set(DEMO_ORDERS.refundNeedsApproval, journey.shippedAt!);
  }

  // c. In transit, arriving tomorrow morning: the reschedule and address-change case.
  {
    const items = [line(PRODUCTS.powerBank), line(PRODUCTS.charger)];
    const journey: Journey = {
      origin: northFc,
      hub: "Shiprocket Kalkaji Hub, New Delhi",
      doorstep: "Lajpat Nagar II, New Delhi",
      shippedAt: past(1, 12, 10),
    };
    orders.push({
      id: DEMO_ORDERS.inTransit,
      customerId: DEMO_CUSTOMER_ID,
      items,
      total: totalOf(items),
      status: "shipped",
      placedAt: past(2, 20, 41),
      address: delhiHome,
      payment: { method: "UPI", ref: "431702689315" },
      shipment: {
        courier: "Shiprocket",
        awb: "14231087654321",
        status: "In transit",
        eta: ahead(1, 10),
        slot: "10 AM – 1 PM",
        events: [
          ...trackingEvents(journey),
          { at: past(1, 22, 30), status: "In transit", location: "Shiprocket Gurugram Sort Centre" },
        ],
      },
    });
  }

  // d. Delivered with an invoice on file: the "send my invoice" case.
  {
    const items = [line(PRODUCTS.keyboard)];
    const journey: Journey = {
      origin: northFc,
      hub: "Delhivery Okhla Hub, New Delhi",
      doorstep: "Lajpat Nagar II, New Delhi",
      shippedAt: past(13, 16, 0),
      reachedHubAt: past(12, 6, 30),
      outForDeliveryAt: past(12, 9, 0),
      deliveredAt: past(12, 13, 37),
    };
    orders.push({
      id: DEMO_ORDERS.invoiceReady,
      customerId: DEMO_CUSTOMER_ID,
      items,
      total: totalOf(items),
      status: "delivered",
      placedAt: past(14, 10, 25),
      deliveredAt: journey.deliveredAt,
      address: delhiHome,
      payment: { method: "NetBanking", ref: "HDFCNB718345201" },
      shipment: {
        courier: "Delhivery",
        awb: "1490835571206",
        status: "Delivered",
        events: trackingEvents(journey),
      },
    });
    invoiceDates.set(DEMO_ORDERS.invoiceReady, journey.shippedAt!);
  }

  // Ananya: a delivered speaker and an order out for delivery today.
  {
    const items = [line(PRODUCTS.speaker)];
    const journey: Journey = {
      origin: southFc,
      hub: "Blue Dart Domlur Hub, Bengaluru",
      doorstep: "Indiranagar, Bengaluru",
      shippedAt: past(28, 11, 0),
      reachedHubAt: past(27, 4, 45),
      outForDeliveryAt: past(26, 9, 20),
      deliveredAt: past(26, 12, 5),
    };
    orders.push({
      id: "NB-23744",
      customerId: "CUST-1002",
      items,
      total: totalOf(items),
      status: "delivered",
      placedAt: past(29, 22, 10),
      deliveredAt: journey.deliveredAt,
      address: bengaluruHome,
      payment: { method: "UPI", ref: "430981274556" },
      shipment: { courier: "Blue Dart", awb: "50911208734", status: "Delivered", events: trackingEvents(journey) },
    });
    invoiceDates.set("NB-23744", journey.shippedAt!);
  }
  {
    const items = [line(PRODUCTS.earbuds), line(PRODUCTS.backpack)];
    const journey: Journey = {
      origin: southFc,
      hub: "Delhivery Indiranagar DC, Bengaluru",
      doorstep: "Indiranagar, Bengaluru",
      shippedAt: past(2, 14, 30),
      reachedHubAt: past(1, 23, 50),
      outForDeliveryAt: past(0, 8, 15),
    };
    orders.push({
      id: "NB-24388",
      customerId: "CUST-1002",
      items,
      total: totalOf(items),
      status: "out_for_delivery",
      placedAt: past(3, 19, 45),
      address: bengaluruHome,
      payment: { method: "UPI", ref: "431687003921" },
      shipment: {
        courier: "Delhivery",
        awb: "1490852209317",
        status: "Out for delivery",
        eta: ahead(0, 13),
        slot: "1 PM – 4 PM",
        events: trackingEvents(journey),
      },
    });
  }

  // Rohit: two recent refunds already paid out, and a third request on a flagged account.
  {
    const items = [line(PRODUCTS.actionCamera)];
    const journey: Journey = {
      origin: westFc,
      hub: "Delhivery Andheri East Hub, Mumbai",
      doorstep: "Andheri West, Mumbai",
      shippedAt: past(57, 15, 0),
      reachedHubAt: past(56, 7, 10),
      outForDeliveryAt: past(55, 9, 0),
      deliveredAt: past(55, 13, 25),
      returnRequestedAt: past(48, 10, 0),
      returnPickedAt: past(46, 15, 40),
      returnReceivedAt: past(45, 12, 0),
      qcPassedAt: past(43, 16, 30),
    };
    orders.push({
      id: "NB-22901",
      customerId: "CUST-1003",
      items,
      total: totalOf(items),
      status: "refunded",
      placedAt: past(58, 20, 15),
      deliveredAt: journey.deliveredAt,
      address: mumbaiHome,
      payment: { method: "Card", ref: "pay_NxR3vT8qLm2KcA" },
      shipment: { courier: "Delhivery", awb: "1490771045832", status: "Return QC passed", events: trackingEvents(journey) },
      return: {
        reason: "Footage stutters at 4K 60fps",
        requestedAt: journey.returnRequestedAt!,
        pickedAt: journey.returnPickedAt,
        qcStatus: "passed",
        qcSince: journey.qcPassedAt,
      },
    });
    invoiceDates.set("NB-22901", journey.shippedAt!);
  }
  {
    const items = [line(PRODUCTS.earbuds)];
    const journey: Journey = {
      origin: westFc,
      hub: "Shiprocket Andheri East Hub, Mumbai",
      doorstep: "Andheri West, Mumbai",
      shippedAt: past(35, 12, 0),
      reachedHubAt: past(34, 6, 0),
      outForDeliveryAt: past(33, 9, 30),
      deliveredAt: past(33, 17, 10),
      returnRequestedAt: past(30, 11, 20),
      returnPickedAt: past(28, 14, 0),
      returnReceivedAt: past(27, 10, 30),
      qcPassedAt: past(26, 15, 15),
    };
    orders.push({
      id: "NB-23415",
      customerId: "CUST-1003",
      items,
      total: totalOf(items),
      status: "refunded",
      placedAt: past(36, 9, 40),
      deliveredAt: journey.deliveredAt,
      address: mumbaiHome,
      payment: { method: "UPI", ref: "430512867390" },
      shipment: {
        courier: "Shiprocket",
        awb: "14229870331256",
        status: "Return QC passed",
        events: trackingEvents(journey),
      },
      return: {
        reason: "Right earbud stops charging",
        requestedAt: journey.returnRequestedAt!,
        pickedAt: journey.returnPickedAt,
        qcStatus: "passed",
        qcSince: journey.qcPassedAt,
      },
    });
    invoiceDates.set("NB-23415", journey.shippedAt!);
  }
  {
    const items = [line(PRODUCTS.headphones)];
    const journey: Journey = {
      origin: westFc,
      hub: "Delhivery Andheri East Hub, Mumbai",
      doorstep: "Andheri West, Mumbai",
      shippedAt: past(12, 13, 0),
      reachedHubAt: past(11, 5, 30),
      outForDeliveryAt: past(10, 8, 50),
      deliveredAt: past(10, 12, 40),
      returnRequestedAt: past(6, 18, 0),
      returnPickedAt: past(4, 12, 25),
      returnReceivedAt: past(3, 10, 15),
    };
    orders.push({
      id: "NB-24236",
      customerId: "CUST-1003",
      items,
      total: totalOf(items),
      status: "return_picked",
      placedAt: past(13, 23, 5),
      deliveredAt: journey.deliveredAt,
      address: mumbaiHome,
      payment: { method: "UPI", ref: "431321905874" },
      shipment: {
        courier: "Delhivery",
        awb: "1490841176509",
        status: "Return received at warehouse",
        events: trackingEvents(journey),
      },
      return: {
        reason: "Not as described",
        requestedAt: journey.returnRequestedAt!,
        pickedAt: journey.returnPickedAt,
        qcStatus: "pending",
        qcSince: journey.returnReceivedAt,
      },
    });
    invoiceDates.set("NB-24236", journey.shippedAt!);
  }

  // Priya: a delivered lamp and a blender still at the warehouse.
  {
    const items = [line(PRODUCTS.deskLamp)];
    const journey: Journey = {
      origin: southFc,
      hub: "Blue Dart Kakkanad Hub, Kochi",
      doorstep: "Kakkanad, Kochi",
      shippedAt: past(11, 10, 30),
      reachedHubAt: past(10, 6, 40),
      outForDeliveryAt: past(9, 9, 15),
      deliveredAt: past(9, 15, 2),
    };
    orders.push({
      id: "NB-24258",
      customerId: "CUST-1004",
      items,
      total: totalOf(items),
      status: "delivered",
      placedAt: past(12, 21, 30),
      deliveredAt: journey.deliveredAt,
      address: kochiHome,
      payment: { method: "UPI", ref: "431412776018" },
      shipment: { courier: "Blue Dart", awb: "50919836412", status: "Delivered", events: trackingEvents(journey) },
    });
    invoiceDates.set("NB-24258", journey.shippedAt!);
  }
  {
    const items = [line(PRODUCTS.blender)];
    orders.push({
      id: "NB-24431",
      customerId: "CUST-1004",
      items,
      total: totalOf(items),
      status: "placed",
      placedAt: past(1, 18, 0),
      address: kochiHome,
      payment: { method: "Card", ref: "pay_PB7mWq3ZrT9yHe" },
      shipment: {
        courier: "Delhivery",
        awb: "1490861130458",
        status: "Ready to ship",
        eta: ahead(4, 12),
        events: trackingEvents({
          origin: southFc,
          hub: "Delhivery Kakkanad DC, Kochi",
          doorstep: "Kakkanad, Kochi",
          manifestedAt: past(1, 20, 0),
        }),
      },
    });
  }

  // Sunita: first order, cash on delivery, in transit.
  {
    const items = [line(PRODUCTS.backpack)];
    const journey: Journey = {
      origin: northFc,
      hub: "Shiprocket Aliganj Hub, Lucknow",
      doorstep: "Aliganj, Lucknow",
      shippedAt: past(1, 15, 20),
    };
    orders.push({
      id: "NB-24415",
      customerId: "CUST-1005",
      items,
      total: totalOf(items),
      status: "shipped",
      placedAt: past(2, 11, 55),
      address: lucknowHome,
      payment: { method: "COD", ref: "COD-NB-24415" },
      shipment: {
        courier: "Shiprocket",
        awb: "14231190264873",
        status: "In transit",
        eta: ahead(2, 10),
        slot: "10 AM – 1 PM",
        events: trackingEvents(journey),
      },
    });
  }

  // Karan: one order outside the 30-day window, one return still waiting for pickup.
  {
    const items = [line(PRODUCTS.charger), line(PRODUCTS.powerBank)];
    const journey: Journey = {
      origin: northFc,
      hub: "Delhivery Industrial Area Hub, Chandigarh",
      doorstep: "Sector 21B, Chandigarh",
      shippedAt: past(36, 10, 0),
      reachedHubAt: past(35, 5, 20),
      outForDeliveryAt: past(34, 9, 0),
      deliveredAt: past(34, 14, 45),
    };
    orders.push({
      id: "NB-23377",
      customerId: "CUST-1006",
      items,
      total: totalOf(items),
      status: "delivered",
      placedAt: past(37, 19, 30),
      deliveredAt: journey.deliveredAt,
      address: chandigarhHome,
      payment: { method: "UPI", ref: "430421558763" },
      shipment: { courier: "Delhivery", awb: "1490762218804", status: "Delivered", events: trackingEvents(journey) },
    });
    invoiceDates.set("NB-23377", journey.shippedAt!);
  }
  {
    const items = [line(PRODUCTS.actionCamera)];
    const journey: Journey = {
      origin: northFc,
      hub: "Blue Dart Chandigarh Hub",
      doorstep: "Sector 21B, Chandigarh",
      shippedAt: past(8, 11, 10),
      reachedHubAt: past(7, 6, 0),
      outForDeliveryAt: past(6, 9, 30),
      deliveredAt: past(6, 13, 50),
      returnRequestedAt: past(2, 17, 35),
    };
    orders.push({
      id: "NB-24290",
      customerId: "CUST-1006",
      items,
      total: totalOf(items),
      status: "return_requested",
      placedAt: past(9, 20, 20),
      deliveredAt: journey.deliveredAt,
      address: chandigarhHome,
      payment: { method: "Card", ref: "pay_PA2cLx8VnQ4sJw" },
      shipment: {
        courier: "Blue Dart",
        awb: "50918470356",
        status: "Return pickup scheduled",
        events: trackingEvents(journey),
      },
      return: {
        reason: "Mount bracket missing from the box",
        requestedAt: journey.returnRequestedAt!,
        qcStatus: "awaiting_pickup",
      },
    });
    invoiceDates.set("NB-24290", journey.shippedAt!);
  }

  const invoices = [...invoiceDates]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([orderId, issuedAt], index) => {
      const order = orders.find((candidate) => candidate.id === orderId)!;
      const invoice = invoiceFor(order, issuedAt, 1812 + index * 13);
      order.invoiceId = invoice.id;
      return invoice;
    });

  const orderById = (id: string) => orders.find((order) => order.id === id)!;
  const refunds: Refund[] = [
    {
      id: "RFND-HX4K7P",
      orderId: "NB-22901",
      amount: orderById("NB-22901").total,
      status: "processed",
      method: refundMethodFor(orderById("NB-22901")),
      idempotencyKey: "refund:NB-22901",
      createdAt: past(42, 14, 5),
      utr: "312874561209",
      expectedBy: past(37, 18, 0),
    },
    {
      id: "RFND-M8Q2ZT",
      orderId: "NB-23415",
      amount: orderById("NB-23415").total,
      status: "processed",
      method: refundMethodFor(orderById("NB-23415")),
      idempotencyKey: "refund:NB-23415",
      createdAt: past(25, 12, 40),
      utr: "430693218847",
      expectedBy: past(22, 18, 0),
    },
  ];

  const tickets: Ticket[] = [
    {
      id: "TCK-20871",
      customerId: DEMO_CUSTOMER_ID,
      orderId: DEMO_ORDERS.refundStuckInQc,
      subject: "Refund not received for returned headphones",
      status: "open",
      priority: "normal",
      notes: [
        "Email from customer: headphones return was picked up, refund still not received.",
        "Auto-reply sent: refunds are processed 5–7 business days after quality check.",
      ],
      createdAt: past(2, 10, 14),
      updatedAt: past(2, 10, 16),
    },
    {
      id: "TCK-20833",
      customerId: "CUST-1003",
      orderId: "NB-24236",
      subject: "Refund request for returned headphones",
      status: "open",
      priority: "normal",
      notes: ["Third refund request in 60 days; account carries the repeat_refund flag."],
      createdAt: past(3, 16, 45),
      updatedAt: past(3, 16, 45),
    },
    {
      id: "TCK-20790",
      customerId: "CUST-1002",
      orderId: "NB-23744",
      subject: "Halo speaker not connecting to Wi-Fi",
      status: "resolved",
      priority: "low",
      notes: ["Guided customer to pair on the 2.4 GHz band; speaker working."],
      createdAt: past(20, 11, 30),
      updatedAt: past(20, 11, 52),
    },
  ];

  return { customers, orders, invoices, refunds, tickets };
}
