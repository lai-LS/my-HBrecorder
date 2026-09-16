import { createClient } from '@supabase/supabase-js';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb', // 音声ファイルの容量上限を設定
        },
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 環境変数からAPIキーを読み込む
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // 強力な権限を持つキー
        const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL;

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        
        const { audioBase64, mimeType, studentId, studentName, studentLevel, studentTrouble1, studentTrouble2, timestamp } = req.body;

        // 1. Base64からBuffer(バイナリ)に戻す
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const extension = mimeType.includes('wav') ? 'wav' : 'webm';
        
        // ファイル名のサニタイズ
        const safeStudentId = studentId.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const safeStudentName = studentName.replace(/[./\\:*?"<>| ]/g, '_');
        const safeStudentLevel = studentLevel.replace(/[./\\:*?"<>| ]/g, ''); 
        const fileName = `${safeStudentId}_${safeStudentName}_${safeStudentLevel}_${timestamp}.${extension}`;

        // 2. Supabase Storageにアップロード
        const { error: uploadError } = await supabase.storage
            .from('recordings')
            .upload(fileName, audioBuffer, {
                contentType: mimeType,
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) throw new Error(`Supabase Upload Error: ${uploadError.message}`);

        // 3. Public URLの取得 (または期限付きURLの発行)
        const { data: { publicUrl } } = supabase.storage
            .from('recordings')
            .getPublicUrl(fileName);

        // 4. GAS(スプレッドシート)へのデータ送信
        const gasPayload = {
            studentId,
            studentName,
            date: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
            studentLevel,
            studentTrouble1,
            studentTrouble2: studentTrouble2 || "",
            audioUrl: publicUrl
        };

        const gasResponse = await fetch(GAS_WEBAPP_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify(gasPayload)
        });

        if (!gasResponse.ok) {
             console.warn('GAS notification failed, but upload succeeded');
        }

        return res.status(200).json({ success: true, publicUrl });

    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ error: error.message });
    }
}
