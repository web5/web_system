const tencentcloud = require('tencentcloud-sdk-nodejs');
const TtsClient = tencentcloud.tts.v20190823.Client;

async function main() {
  const client = new TtsClient({
    credential: {
      secretId: process.env.TENCENT_SECRET_ID || 'your-secret-id',
      secretKey: process.env.TENCENT_SECRET_KEY || 'your-secret-key',
    },
    region: 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'tts.tencentcloudapi.com' } },
  });

  try {
    const res = await client.TextToVoice({
      Text: 'hello',
      SessionId: 'test-001',
      VoiceType: 603007, // 邻家女孩
      Codec: 'mp3',
      SampleRate: 16000,
      Speed: 0,
      Volume: 5,
      PrimaryLanguage: 2,
    });
    console.log('✅ 成功! Audio长度:', res.Audio?.length, '字符');
    console.log('   RequestId:', res.RequestId);
  } catch (e) {
    console.log('❌ 失败:', e.message);
    console.log('   错误码:', e.code);
  }
}

main();
