#!/bin/bash
# 驗證 Dockerfile 是否正確

echo "檢查 Dockerfile.embedding..."
if grep -q "embed_plants.py" Dockerfile.embedding; then
    echo "❌ 發現 embed_plants.py 引用"
    exit 1
else
    echo "✅ 沒有 embed_plants.py 引用"
fi

echo ""
echo "檢查必要的 COPY 指令..."
required=("start_api.py" "search_plants.py" "feature_weights.py" "trait_tokenizer.py" "trait_vocab.json" "normalize_features.py")
missing=0
for file in "${required[@]}"; do
    if grep -q "COPY.*$file" Dockerfile.embedding; then
        echo "  ✅ $file"
    else
        echo "  ❌ 缺少 $file"
        missing=1
    fi
done

if [ $missing -eq 0 ]; then
    echo ""
    echo "✅ Dockerfile.embedding 驗證通過"
    exit 0
else
    echo ""
    echo "❌ Dockerfile.embedding 驗證失敗"
    exit 1
fi
