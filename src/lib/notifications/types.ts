export type NotificationChannel = 'buzzer' | 'sms' | 'none'
export type NotificationStatus = 'pending' | 'delivered' | 'failed'

export interface NotificationResult {
  channel: NotificationChannel
  status: NotificationStatus
  error?: string
}

export interface NotificationProvider {
  sendBuzzerNotification(workzoneId: string): Promise<NotificationResult>
  sendSmsNotification(workzoneId: string, recipients: string[]): Promise<NotificationResult>
}
