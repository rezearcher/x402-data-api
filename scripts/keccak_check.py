# Minimal Keccak-256 (not SHA3 — Keccak padding 0x01). Self-validated below.
def keccak256(msg: bytes) -> bytes:
    R = 1088 // 8  # rate in bytes for 256-bit
    RC = [0x0000000000000001,0x0000000000008082,0x800000000000808A,0x8000000080008000,
          0x000000000000808B,0x0000000080000001,0x8000000080008081,0x8000000000008009,
          0x000000000000008A,0x0000000000000088,0x0000000080008009,0x000000008000000A,
          0x000000008000808B,0x800000000000008B,0x8000000000008089,0x8000000000008003,
          0x8000000000008002,0x8000000000000080,0x000000000000800A,0x800000008000000A,
          0x8000000080008081,0x8000000000008080,0x0000000080000001,0x8000000080008008]
    r = [[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]]
    def rol(x,n): return ((x<<n)|(x>>(64-n)))&0xFFFFFFFFFFFFFFFF
    # pad
    m = bytearray(msg)
    m.append(0x01)
    while len(m)%R!=0: m.append(0x00)
    m[-1]^=0x80
    S=[[0]*5 for _ in range(5)]
    for off in range(0,len(m),R):
        blk=m[off:off+R]
        for i in range(R//8):
            lane=int.from_bytes(blk[i*8:i*8+8],'little')
            S[i%5][i//5]^=lane
        # permutation 24 rounds
        for rnd in range(24):
            C=[S[x][0]^S[x][1]^S[x][2]^S[x][3]^S[x][4] for x in range(5)]
            D=[C[(x-1)%5]^rol(C[(x+1)%5],1) for x in range(5)]
            for x in range(5):
                for y in range(5):
                    S[x][y]^=D[x]
            B=[[0]*5 for _ in range(5)]
            for x in range(5):
                for y in range(5):
                    B[y][(2*x+3*y)%5]=rol(S[x][y],r[x][y])
            for x in range(5):
                for y in range(5):
                    S[x][y]=B[x][y]^((~B[(x+1)%5][y])&B[(x+2)%5][y])
            S[0][0]^=RC[rnd]
    out=bytearray()
    for i in range(R//8):
        out+=int(S[i%5][i//5]).to_bytes(8,'little')
        if len(out)>=32: break
    return bytes(out[:32])

def sel(sig): return "0x"+keccak256(sig.encode()).hex()
anchor = sel("Transfer(address,address,uint256)")
print("Transfer anchor:", anchor, "OK" if anchor=="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" else "FAIL")
for s in ["AuthorizationUsed(address,bytes32)","authorizationState(address,bytes32)"]:
    h=sel(s); print(s, h, "selector="+h[:10])
