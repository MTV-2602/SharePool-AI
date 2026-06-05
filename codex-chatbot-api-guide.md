# Hướng dẫn kết nối API Portal làm Chatbot (Xoay vòng tài khoản ChatGPT)

Tài liệu này cung cấp đặc tả API và các đoạn mã mẫu để cấu hình và tích hợp API Portal của bạn làm backend cho chatbot bằng cách sử dụng pool xoay vòng tài khoản ChatGPT.

---

## 🔐 1. Xác thực (Authentication)
Tất cả các yêu cầu gửi đến API đều yêu cầu header `Authorization` chứa API Key tương ứng được tạo từ trang quản lý của bạn:

```http
Authorization: Bearer <YOUR_PORTAL_API_KEY>
Content-Type: application/json
```

---

## 🛠️ 2. Endpoint gọi API Chatbot
Để gọi xoay vòng tài khoản ChatGPT, sử dụng endpoint sau:

*   **HTTP Method:** `POST`
*   **Base URL (Endpoint):** `https://vinhcousera.vercel.app/v1/chat/completions`
*   **Model hỗ trợ:** `gpt-4o`, `gpt-4o-mini` (Khuyên dùng vì phản hồi rất nhanh và tiết kiệm token), `gpt-3.5-turbo`, `gpt-4`

### Cấu trúc Request Payload (JSON)
```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {
      "role": "system",
      "content": "Bạn là chatbot hỗ trợ khách hàng thân thiện và chuyên nghiệp."
    },
    {
      "role": "user",
      "content": "Xin chào! Cho tôi hỏi shop có những dịch vụ nào?"
    }
  ],
  "stream": false
}
```

### Cấu trúc Response Payload (JSON chuẩn OpenAI)
```json
{
  "id": "chatcmpl-9x87y212a7f8d",
  "object": "chat.completion",
  "created": 1717670000,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Xin chào! Chúng tôi cung cấp các dịch vụ tuyển sinh, gia sư và hỗ trợ học tập..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 25,
    "total_tokens": 45
  }
}
```

---

## 💻 3. Mã mẫu tích hợp (Code Snippets)

### 3.1 NodeJS - Sử dụng Thư viện OpenAI SDK (`npm install openai`)
```javascript
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: 'YOUR_PORTAL_API_KEY', // Thay bằng API Key của bạn từ Admin Portal
  baseURL: 'https://vinhcousera.vercel.app/v1' // Trỏ về Portal xoay vòng ChatGPT
});

async function runChatbot() {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Chọn model ChatGPT muốn dùng
      messages: [
        { role: 'system', content: 'Bạn là một chatbot hỗ trợ đắc lực.' },
        { role: 'user', content: 'Xin chào, hãy giới thiệu bản thân nhé.' }
      ],
      stream: false // Đổi thành true nếu muốn nhận phản hồi dạng streaming
    });

    console.log('Bot trả lời:', completion.choices[0].message.content);
  } catch (error) {
    console.error('Lỗi khi gọi API:', error.message);
  }
}

runChatbot();
```

### 3.2 Python - Sử dụng Thư viện OpenAI SDK (`pip install openai`)
```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_PORTAL_API_KEY", # Thay bằng API Key của bạn từ Admin Portal
    base_url="https://vinhcousera.vercel.app/v1" # Trỏ về Portal xoay vòng ChatGPT
)

try:
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Bạn là trợ lý AI thông thái."},
            {"role": "user", "content": "Làm thế nào để học lập trình nhanh?"}
        ]
    )
    print("Bot trả lời:", completion.choices[0].message.content)
except Exception as e:
    print("Lỗi kết nối:", e)
```

### 3.3 NodeJS - Sử dụng Fetch (Không cần thư viện bên thứ ba)
```javascript
async function askChatbot(prompt) {
  const url = 'https://vinhcousera.vercel.app/v1/chat/completions';
  const apiKey = 'YOUR_PORTAL_API_KEY'; // Thay bằng API Key từ Portal

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user', content: prompt }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Lỗi API:', error.message);
  }
}

// Gọi thử nghiệm
askChatbot('Chào bạn!').then(res => console.log('Trả lời:', res));
```

### 3.4 C# (.NET) - Sử dụng HttpClient (Mặc định, không cài thêm thư viện)
```csharp
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Text.Json;

class Program
{
    private static readonly HttpClient client = new HttpClient();

    static async Task Main()
    {
        string url = "https://vinhcousera.vercel.app/v1/chat/completions";
        string apiKey = "YOUR_PORTAL_API_KEY"; // API Key từ Admin Portal

        var payload = new
        {
            model = "gpt-4o-mini",
            messages = new[]
            {
                new { role = "user", content = "Xin chào! Bạn là ai?" }
            }
        };

        var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Add("Authorization", $"Bearer {apiKey}");
        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        try
        {
            var response = await client.SendAsync(request);
            response.EnsureSuccessStatusCode();
            string jsonResponse = await response.Content.ReadAsStringAsync();
            
            using var doc = JsonDocument.Parse(jsonResponse);
            string answer = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            Console.WriteLine("Bot trả lời: " + answer);
        }
        catch (Exception ex)
        {
            Console.WriteLine("Lỗi: " + ex.Message);
        }
    }
}
```

### 3.5 C# (.NET) - Sử dụng Thư viện OpenAI NuGet chính thức (`using OpenAI.Chat`)
*Cài đặt Package qua NuGet:* `dotnet add package OpenAI`

```csharp
using System;
using System.ClientModel;
using OpenAI.Chat;

class Program
{
    static void Main()
    {
        string apiKey = "YOUR_PORTAL_API_KEY"; // API Key từ Admin Portal
        
        var options = new ChatClientOptions
        {
            Endpoint = new Uri("https://vinhcousera.vercel.app/v1") // Trỏ về Portal của bạn
        };
        
        // Khởi tạo Client
        ChatClient client = new ChatClient("gpt-4o-mini", new ApiKeyCredential(apiKey), options);

        try
        {
            ChatCompletion completion = client.CompleteChat("Hãy giới thiệu ngắn về bản thân.");
            Console.WriteLine("Bot trả lời: " + completion.Content[0].Text);
        }
        catch (Exception ex)
        {
            Console.WriteLine("Lỗi: " + ex.Message);
        }
    }
}
```

