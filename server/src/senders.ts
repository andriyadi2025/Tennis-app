import nodemailer from 'nodemailer'
import { config, smsConfigured, smtpConfigured } from './config.ts'

/**
 * Saluran pengiriman di balik satu antarmuka. Tanpa kredensial, isinya
 * dicetak ke log server — itu transport pengembangan yang lazim, bukan
 * kepura-puraan: kodenya sungguhan dan bisa dipakai untuk menyelesaikan
 * alurnya. Yang tidak boleh terjadi adalah mengaku "terkirim" padahal tidak
 * ke mana-mana, jadi hasilnya selalu menyebut saluran mana yang dipakai.
 */

export type DeliveryChannel = 'twilio' | 'smtp' | 'log'

export interface DeliveryResult {
  channel: DeliveryChannel
  /** True hanya kalau benar-benar sampai ke penyedia luar. */
  delivered: boolean
}

export async function sendSms(to: string, message: string): Promise<DeliveryResult> {
  if (!smsConfigured()) {
    console.info(`[SMS→log] ${to}: ${message}`)
    return { channel: 'log', delivered: false }
  }

  const { accountSid, authToken, from } = config.sms
  const body = new URLSearchParams({ To: to, From: from!, Body: message })
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  )

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Twilio menolak permintaan (${response.status}): ${detail.slice(0, 200)}`)
  }
  return { channel: 'twilio', delivered: true }
}

let transporter: nodemailer.Transporter | null = null

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<DeliveryResult> {
  if (!smtpConfigured()) {
    console.info(`[Email→log] ${to} · ${subject}\n${text}`)
    return { channel: 'log', delivered: false }
  }

  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user!, pass: config.smtp.pass! },
  })

  await transporter.sendMail({ from: config.smtp.from, to, subject, text })
  return { channel: 'smtp', delivered: true }
}
