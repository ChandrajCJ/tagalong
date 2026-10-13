/**
 * Airports a confirmation email is likely to mention, with their city and
 * time zone, so "BOM → GOI 08:15" becomes a real instant. Not every airport:
 * unknown codes still work, their times just fall back to the trip's zone.
 */
const ZONES: Record<string, string[]> = {
  'Asia/Kolkata': [
    'BOM Mumbai', 'DEL Delhi', 'BLR Bengaluru', 'MAA Chennai', 'CCU Kolkata', 'HYD Hyderabad', 'GOI Goa', 'GOX Goa',
    'COK Kochi', 'TRV Thiruvananthapuram', 'AMD Ahmedabad', 'PNQ Pune', 'JAI Jaipur', 'LKO Lucknow', 'IXC Chandigarh',
    'SXR Srinagar', 'IXL Leh', 'IXB Bagdogra', 'GAU Guwahati', 'IXZ Port Blair', 'VNS Varanasi', 'PAT Patna',
    'BBI Bhubaneswar', 'IXE Mangaluru', 'CJB Coimbatore', 'TRZ Tiruchirappalli', 'IXM Madurai', 'VTZ Visakhapatnam',
    'NAG Nagpur', 'IDR Indore', 'BHO Bhopal', 'UDR Udaipur', 'JDH Jodhpur', 'ATQ Amritsar', 'DED Dehradun', 'IXR Ranchi',
    'RPR Raipur', 'CCJ Kozhikode', 'STV Surat', 'BDQ Vadodara', 'IXJ Jammu', 'AGR Agra', 'HBX Hubballi',
  ],
  'Asia/Dubai': ['DXB Dubai', 'AUH Abu Dhabi', 'SHJ Sharjah'],
  'Asia/Qatar': ['DOH Doha'],
  'Asia/Muscat': ['MCT Muscat'],
  'Asia/Singapore': ['SIN Singapore'],
  'Asia/Bangkok': ['BKK Bangkok', 'DMK Bangkok', 'HKT Phuket'],
  'Asia/Kuala_Lumpur': ['KUL Kuala Lumpur'],
  'Asia/Colombo': ['CMB Colombo'],
  'Asia/Kathmandu': ['KTM Kathmandu'],
  'Indian/Maldives': ['MLE Malé'],
  'Asia/Makassar': ['DPS Bali'],
  'Asia/Tokyo': ['NRT Tokyo', 'HND Tokyo'],
  'Asia/Hong_Kong': ['HKG Hong Kong'],
  'Europe/London': ['LHR London', 'LGW London', 'STN London', 'MAN Manchester', 'EDI Edinburgh'],
  'Europe/Lisbon': ['LIS Lisbon', 'OPO Porto', 'FAO Faro'],
  'Europe/Paris': ['CDG Paris', 'ORY Paris', 'NCE Nice'],
  'Europe/Berlin': ['FRA Frankfurt', 'MUC Munich', 'BER Berlin'],
  'Europe/Amsterdam': ['AMS Amsterdam'],
  'Europe/Madrid': ['MAD Madrid', 'BCN Barcelona'],
  'Europe/Rome': ['FCO Rome', 'MXP Milan'],
  'Europe/Zurich': ['ZRH Zurich', 'GVA Geneva'],
  'Europe/Istanbul': ['IST Istanbul'],
  'America/New_York': ['JFK New York', 'EWR Newark', 'BOS Boston'],
  'America/Los_Angeles': ['LAX Los Angeles', 'SFO San Francisco', 'SEA Seattle'],
  'America/Chicago': ['ORD Chicago'],
  'America/Toronto': ['YYZ Toronto'],
  'Australia/Sydney': ['SYD Sydney', 'MEL Melbourne'],
};

export const AIRPORTS = new Map<string, { city: string; timezone: string }>(
  Object.entries(ZONES).flatMap(([timezone, list]) =>
    list.map((entry) => [entry.slice(0, 3), { city: entry.slice(4), timezone }] as const),
  ),
);

/** Two-letter codes of airlines flying in and out of India, and a few more. */
export const AIRLINES: Record<string, string> = {
  '6E': 'IndiGo',
  AI: 'Air India',
  IX: 'Air India Express',
  UK: 'Vistara',
  SG: 'SpiceJet',
  QP: 'Akasa Air',
  I5: 'AIX Connect',
  G8: 'Go First',
  '9I': 'Alliance Air',
  EK: 'Emirates',
  QR: 'Qatar Airways',
  EY: 'Etihad',
  SQ: 'Singapore Airlines',
  TG: 'Thai Airways',
  BA: 'British Airways',
  LH: 'Lufthansa',
  AF: 'Air France',
  KL: 'KLM',
  TP: 'TAP Air Portugal',
  FR: 'Ryanair',
  U2: 'easyJet',
  VS: 'Virgin Atlantic',
  UL: 'SriLankan',
  WY: 'Oman Air',
  FZ: 'flydubai',
  G9: 'Air Arabia',
  TK: 'Turkish Airlines',
  LX: 'SWISS',
};
