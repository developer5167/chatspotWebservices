// test-chroma.js
const { ChromaClient } = require('chromadb');

async function testChroma() {
  const chroma = new ChromaClient({ path: "http://localhost:8000" });
  
  try {
    console.log('Testing ChromaDB v2 connection...');
    
    // List collections
    const collections = await chroma.listCollections();
    console.log('✅ Collections:', collections.length);
    
    // Create a test collection
    const collection = await chroma.createCollection({ 
      name: "test_collection_v2" 
    });
    console.log('✅ Collection created');
    
    // Add some data
    await collection.add({
      ids: ["test1", "test2"],
      documents: ["Hello world", "Testing ChromaDB v2"],
      metadatas: [{ type: "test" }, { type: "test" }],
      embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
    });
    console.log('✅ Data added');
    
    // Query data
    const results = await collection.query({
      queryEmbeddings: [[0.1, 0.2, 0.3]],
      nResults: 2
    });
    console.log('✅ Query successful:', results.documents);
    
    console.log('🎉 ChromaDB v2 is working perfectly!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testChroma();