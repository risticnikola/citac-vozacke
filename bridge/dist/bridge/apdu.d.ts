export interface ApduCommand {
    cla: number;
    ins: number;
    p1: number;
    p2: number;
    data?: Buffer;
    le?: number;
}
export declare function buildApdu(cmd: ApduCommand): Buffer;
export declare function parseApduResponse(buf: Buffer): {
    data: Buffer;
    sw1: number;
    sw2: number;
    ok: boolean;
};
/** Standard ISO 7816-4 commands for diagnostic use */
export declare const ISO7816: {
    readonly selectMasterFile: () => Buffer;
    readonly selectEfById: (fileId: Buffer) => Buffer;
    readonly readBinary: (offset: number, length: number) => Buffer;
    readonly getChallenge: () => Buffer;
};
