import { type NotificationProvider, type NotificationResult, type NotificationChannel } from './types'

export class TestNotificationProvider implements NotificationProvider {
  async sendBuzzerNotification(workzoneId: string): Promise<NotificationResult> {
    console.log(`[TEST-NOTIFICATION] Buzzer notification dispatched for workzone ${workzoneId}`)
    return {
      channel: 'buzzer',
      status: 'delivered',
    }
  }

  async sendSmsNotification(workzoneId: string, _recipients: string[]): Promise<NotificationResult> {
    console.log(`[TEST-NOTIFICATION] SMS notification dispatched for workzone ${workzoneId}`)
    return {
      channel: 'sms',
      status: 'delivered',
    }
  }
}

let sharedInstance: TestNotificationProvider | null = null

export function getTestNotificationProvider(): TestNotificationProvider {
  if (!sharedInstance) {
    sharedInstance = new TestNotificationProvider()
  }
  return sharedInstance
}
