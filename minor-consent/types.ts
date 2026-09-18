/**
 * 未成年利用・保護者同意書（Web版）の Firestore データモデル。
 *
 * 既存のブックルに合わせた前提:
 *  - すべてのドキュメントはマルチテナント識別子 `orgId` を持つ
 *    （例: スタジオDancers = "P472wbOrUKhQ6DGLPOBTXJptXwt2"）
 *  - 会員は LINE ユーザー ID をキーに `users/{lineUserId}` で管理されている
 *  - 日時は firebase-admin の Timestamp を使う
 */

import type { Timestamp } from 'firebase-admin/firestore';

export type { Timestamp };

/** 同意記録のライフサイクル。 */
export type ConsentStatus =
  | 'pending'    // リンクを発行済み。保護者はまだ送信していない
  | 'submitted'  // 保護者が送信済み。スタッフの確認待ち
  | 'approved'   // スタッフが本人確認書類と署名を突き合わせて承認
  | 'rejected'   // 書類不備などで差し戻し
  | 'expired'    // 有効期限切れ。再取得が必要
  | 'revoked';   // 保護者または運営者が撤回

/**
 * 本人確認書類の種別。
 * 運転免許を持たない保護者が一定数いるため、免許証だけに限定しない。
 * マイナンバーカードは個人番号の記載がない「表面のみ」に限る。
 */
export type IdDocumentType =
  | 'drivers_license'
  | 'my_number_card_front'
  | 'passport'
  | 'residence_card'
  | 'health_insurance_card';

export type Relationship = 'father' | 'mother' | 'other';

/** 同意書の案内を届ける経路。 */
export type NotifyChannel =
  | 'line_member'    // 会員本人の LINE へ送り、保護者に転送してもらう
  | 'sms_guardian'   // 保護者の電話番号へ直接 SMS
  | 'email_member';  // LINE 未連携の会員向けの控え経路

/** 同意書が必要だと判断した経緯。users に生年月日が無いため複数経路を持つ。 */
export type ConsentTrigger =
  | 'self_declared'  // 予約時に「未成年のみで利用」と申告された
  | 'staff_flag'     // スタッフが管理画面で未成年フラグを立てた
  | 'birth_date';    // 会員の生年月日から自動判定（生年月日の収集後に有効になる）

/** 同意文言の各条項。consent-text.v1.ja.md の見出し ID と対応する。 */
export type ClauseId = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7';

/** 利用者（未成年者）情報。紙版「1. ご利用者（未成年者）情報」に対応。 */
export interface MinorProfile {
  name: string;
  nameKana: string;
  /** ISO 8601 の日付 (YYYY-MM-DD)。年齢はここから毎回計算し、保存しない。 */
  birthDate: string;
  /** 紙版の「学年」。任意。 */
  grade?: string;
  address: string;
  phone: string;
}

/** 保護者（親権者）情報。紙版「2. 保護者（親権者）情報」に対応。 */
export interface GuardianProfile {
  name: string;
  relationship: Relationship;
  /** relationship が 'other' のときの続柄。 */
  relationshipOther?: string;
  /** 日中の連絡先。SMS 認証の送信先も兼ねる。 */
  phone: string;
  /** true なら利用者と同一住所として PDF に出力する。 */
  sameAddressAsMinor: boolean;
  /** sameAddressAsMinor が false のときのみ入力。 */
  address?: string;
  emergencyContact: string;
}

/**
 * 本人確認書類のうち、管理画面の一覧に出しても差し支えない要約。
 * `minorConsents/{consentId}` 本体に置く。
 */
export interface IdDocumentStatus {
  type: IdDocumentType;
  uploaded: boolean;
  /** スタッフが書類の氏名と guardian.name の一致を目視確認したか。 */
  nameMatchConfirmed: boolean;
  /** この日時を過ぎたら画像を自動削除する（承認から 90 日）。 */
  deleteAfter: Timestamp;
  /** 実際に削除された日時。以後 画像は存在せず、確認済みの事実だけが残る。 */
  deletedAt?: Timestamp;
}

/**
 * `minorConsents/{consentId}/sensitive/idDocument`
 *
 * 本人確認書類の実体への参照。Firestore のセキュリティルールは
 * フィールド単位の読み取り制御ができないため、画像パスと書類上の氏名は
 * 親ドキュメントから切り離してサブコレクションに置き、クライアントからは
 * 一切読めなくする。閲覧は必ず Cloud Functions 経由とし、そのつど
 * minorConsentAccessLogs に記録を残す。
 *
 * 画像は Firebase Storage の非公開パスに置き、閲覧のたびに数分で失効する
 * 署名付き URL を発行する。領収書で使っている `?alt=media&token=` 形式の
 * 恒久 URL は、URL を知る者が無期限に開けてしまうため使用しない。
 */
export interface IdDocumentSensitive {
  /** 非公開バケット内のパス。ダウンロード URL は保存しない。 */
  storagePath: string;
  uploadedAt: Timestamp;
  /** 書類に記載された氏名。guardian.name との突き合わせに使う。 */
  nameOnDocument?: string;
}

/** 署名。手書き画像は Storage に置き、パスのみを保持する。 */
export interface Signatures {
  guardianStoragePath: string;
  /** 紙版には利用者本人の署名欄もあるため任意で受け取る。 */
  minorStoragePath?: string;
  signedAt: Timestamp;
}

/**
 * 送信時の証跡。紙版の「記入日」と押印に代わり、
 * 誰がいつどの端末から同意したかを記録する。
 */
export interface ConsentEvidence {
  /** SMS 認証を通過した電話番号。guardian.phone と一致するはず。 */
  verifiedPhone: string;
  phoneVerifiedAt: Timestamp;
  ip: string;
  userAgent: string;
}

/** `minorConsents/{consentId}` */
export interface MinorConsent {
  orgId: string;
  /** 対象店舗。全店共通の同意なら null。 */
  shopId: string | null;

  /** 会員（未成年者）の LINE ユーザー ID。`users/{lineUserId}` を指す。 */
  memberLineUserId: string;

  minor: MinorProfile;
  guardian: GuardianProfile;

  /** 各条項への個別同意。すべて true でなければ送信できない。 */
  agreements: Record<ClauseId, boolean>;
  /** 同意時点の consent-text の版。過去の記録では書き換えない。 */
  consentTextVersion: string;

  signatures: Signatures;
  /** 実体は sensitive/idDocument サブドキュメントにある。 */
  idDocumentStatus: IdDocumentStatus;
  evidence: ConsentEvidence;

  /** 生成された同意書 PDF。控えとして保護者へ送付する。 */
  pdf?: {
    storagePath: string;
    /** 領収書の RC-YYYYMMDD-HHMMSS に倣った採番。例: MC-20260905-140312 */
    documentNumber: string;
    generatedAt: Timestamp;
  };

  /** 同意書が必要になったきっかけ。 */
  trigger: {
    source: ConsentTrigger;
    /** self_declared のとき、申告のあった予約。 */
    bookingId?: string;
    at: Timestamp;
  };

  /**
   * 案内の配信状況。管理画面の「再送」ボタンはここを見て出し分ける。
   * 送信の明細は minorConsentNotifications に残す。
   */
  delivery: {
    /** 初回を含む送信回数。 */
    sendCount: number;
    lastSentAt?: Timestamp;
    lastChannel?: NotifyChannel;
    /** 送信したスタッフの UID、自動送信なら 'system'。 */
    lastSentBy?: string;
    /**
     * 次に再送できるようになる時刻。既定は最終送信から 10 分。
     * 保護者への連投を防ぐためのクールダウン。
     */
    resendAvailableAt?: Timestamp;
  };

  status: ConsentStatus;
  submittedAt?: Timestamp;
  /** 承認したスタッフ。紙版の「受付」欄に相当。 */
  approvedAt?: Timestamp;
  approvedBy?: string;
  rejectedReason?: string;

  /**
   * 同意の有効期限。取得から 1 年、または利用者が 18 歳に到達する日の
   * いずれか早い方。期限を過ぎた同意では 21:00 以降の予約を通さない。
   */
  expiresAt: Timestamp;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * `minorConsentLinks/{token}`
 * 保護者へ送る使い捨てリンク。保護者はブックルのアカウントを持たないため、
 * このトークンだけがフォームへの入口になる。
 */
export interface MinorConsentLink {
  orgId: string;
  memberLineUserId: string;
  /** 発行済みの同意記録。保護者の送信でこのドキュメントが埋まる。 */
  consentId: string;
  /** 発行から 72 時間。 */
  expiresAt: Timestamp;
  /** 一度使ったら再利用させない。 */
  usedAt?: Timestamp;
  /**
   * 再送で新しいトークンを発行したときに、古いトークンを失効させる。
   * 古いリンクが生き続けると、保護者がどれを開いたか分からなくなるため。
   */
  revokedAt?: Timestamp;
  /** 失効させた理由となる新しいトークン。 */
  supersededByToken?: string;
  /** 発行したスタッフの UID、または自動発行なら 'system'。 */
  createdBy: string;
  createdAt: Timestamp;
}

/**
 * `minorConsentNotifications/{notificationId}`
 * 同意書の案内を送った履歴。管理画面に「いつ・どこへ・誰が送ったか」を出し、
 * 二重送信の判断材料にする。
 */
export interface MinorConsentNotification {
  orgId: string;
  consentId: string;
  channel: NotifyChannel;
  /** 送信先。電話番号やメールは下 4 桁などに丸めて保存する。 */
  toMasked: string;
  /** このとき案内したリンクのトークン。 */
  linkToken: string;
  /** 初回送信なら false、再送なら true。 */
  isResend: boolean;
  sentAt: Timestamp;
  /** 送信したスタッフの UID、自動送信なら 'system'。 */
  sentBy: string;
  result: 'sent' | 'failed';
  /** result が 'failed' のときの理由。LINE のブロックなど。 */
  error?: string;
}

/**
 * `minorConsentAccessLogs/{logId}`
 * 本人確認書類を誰がいつ開いたかの記録。画像そのものより長く保管する。
 */
export interface MinorConsentAccessLog {
  orgId: string;
  consentId: string;
  actorUid: string;
  action: 'view_id_document' | 'download_pdf' | 'approve' | 'reject';
  at: Timestamp;
  ip: string;
}
