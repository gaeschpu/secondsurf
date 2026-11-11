// A payment file for Swiss e-banking: ISO 20022 pain.001.001.09 (Swiss Payment Standards), credit transfers in CHF to
// Swiss / Liechtenstein IBANs. Uploaded in the owner's e-banking ("Zahlungsdatei hochladen" / "Datei-Upload"), it creates
// one payment per seller payout, which the owner then approves there. Used by /api/admin/sellers/payouts/pain001.

export interface Transfer {
	/** Short reference, shown in the bank statement as the payment id. */
	id: string;
	name: string;
	iban: string;
	amount: number;
	/** Free text for the creditor (max. 140 characters). */
	message: string;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
/** Characters Swiss banks accept in pain.001 (Latin letters, digits and common punctuation); anything else becomes a space. */
const clean = (s: string, max: number) =>
	s
		.normalize('NFC')
		.replace(/[^A-Za-z0-9 .,:'+\-/()?ÄÖÜäöüàâçéèêëîïôûùÿñÀÂÇÉÈÊËÎÏÔÛÙ&*;=@%_!#$<>"\[\]{}|~\\^`]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
const bare = (iban: string) => iban.replace(/\s+/g, '').toUpperCase();
const money = (n: number) => n.toFixed(2);

/** The next working day (Mon–Fri), as YYYY-MM-DD. */
function nextWorkingDay(from = new Date()) {
	const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1));
	while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

export function pain001(debtor: { name: string; iban: string }, transfers: Transfer[], now = new Date()) {
	const stamp = now.toISOString().slice(0, 19);
	const msgId = `SS${stamp.replace(/\D/g, '')}`;
	const total = money(transfers.reduce((sum, t) => sum + Math.round(t.amount * 100), 0) / 100);
	const debtorIban = bare(debtor.iban);
	// Swiss bank clearing number (IID): characters 5 to 9 of a CH/LI IBAN.
	const iid = debtorIban.slice(4, 9);
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
		'<CstmrCdtTrfInitn>',
		'<GrpHdr>',
		`<MsgId>${msgId}</MsgId>`,
		`<CreDtTm>${stamp}</CreDtTm>`,
		`<NbOfTxs>${transfers.length}</NbOfTxs>`,
		`<CtrlSum>${total}</CtrlSum>`,
		`<InitgPty><Nm>${xml(clean(debtor.name, 70))}</Nm></InitgPty>`,
		'</GrpHdr>',
		'<PmtInf>',
		`<PmtInfId>${msgId}-1</PmtInfId>`,
		'<PmtMtd>TRF</PmtMtd>',
		'<BtchBookg>false</BtchBookg>',
		`<NbOfTxs>${transfers.length}</NbOfTxs>`,
		`<CtrlSum>${total}</CtrlSum>`,
		`<ReqdExctnDt><Dt>${nextWorkingDay(now)}</Dt></ReqdExctnDt>`,
		`<Dbtr><Nm>${xml(clean(debtor.name, 70))}</Nm></Dbtr>`,
		`<DbtrAcct><Id><IBAN>${debtorIban}</IBAN></Id></DbtrAcct>`,
		`<DbtrAgt><FinInstnId><ClrSysMmbId><ClrSysId><Cd>CHBCC</Cd></ClrSysId><MmbId>${iid}</MmbId></ClrSysMmbId></FinInstnId></DbtrAgt>`,
		...transfers.map((t) =>
			[
				'<CdtTrfTxInf>',
				`<PmtId><InstrId>${xml(t.id)}</InstrId><EndToEndId>${xml(t.id)}</EndToEndId></PmtId>`,
				`<Amt><InstdAmt Ccy="CHF">${money(t.amount)}</InstdAmt></Amt>`,
				`<Cdtr><Nm>${xml(clean(t.name, 70))}</Nm></Cdtr>`,
				`<CdtrAcct><Id><IBAN>${bare(t.iban)}</IBAN></Id></CdtrAcct>`,
				`<RmtInf><Ustrd>${xml(clean(t.message, 140))}</Ustrd></RmtInf>`,
				'</CdtTrfTxInf>',
			].join(''),
		),
		'</PmtInf>',
		'</CstmrCdtTrfInitn>',
		'</Document>',
	];
	return lines.join('\n');
}
